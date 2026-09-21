import type {
  ConversationItem,
  ConversationTurn,
  ConversationUsage,
  FinalAnswerStructured,
  ToolPayload,
} from "../../../session/index.ts"
import type { AgentDurableTurnStopReason } from "../../../session/index.ts"
import type { ParsedHookExecution } from "../hook-execution.ts"
import type { CodeMTurnInitialSubmission } from "../projection-port.ts"
import { sessionFileError } from "../jsonl.ts"
import {
  appendConversationAssistantText,
  activeTurnLifecycle,
  addConversationUsage,
  terminalTurnLifecycle,
  type ConversationTurnLifecycle,
} from "../../../session/index.ts"
import {
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireNullableNumber,
  requireTimestamp,
} from "../fields.ts"
import {
  canonicalTurnStopReason,
  decodePersistedTurnStopReason,
  durableTurnStopReason,
} from "../stop-reason.ts"
import type { TurnRecordContext } from "./records.ts"

/**
 * Per-engine-turn source facts the structural emitter (§5.3 / §7.2
 * `session_engine_turns`) needs: the CLI `turn_index`, the line that opened it
 * (`turn_request`/`checkpoint`), and the `turn_end` line + durable stop reason
 * that closed it. Bounded by one conversation turn's engine turns, like
 * `engineTurnIndexes`.
 */
export interface EngineTurnSource {
  readonly turnIndex: number
  readonly requestLine: number
  endLine: number | null
  stopReason: AgentDurableTurnStopReason | null
  lifecycle: 'open' | 'ended'
}

/** 流式读取期间可变的一轮对话，冻结后成为 ConversationTurn。 */
export interface MutableConversationTurn {
  readonly id: string
  readonly index: number
  readonly initialSubmission: CodeMTurnInitialSubmission
  readonly engineTurnIndexes: number[]
  readonly engineTurns: EngineTurnSource[]
  lifecycle: ConversationTurnLifecycle
  model: string | null
  readonly provider: string | null
  readonly startedAt: string
  readonly items: ConversationItem[]
  readonly pendingToolDeclarations: Map<string, PendingToolDeclaration>
  readonly pendingFinalAnswers: Map<string, FinalAnswerStructured>
  readonly pendingBackgroundDispatches: PendingBackgroundDispatch[]
  // CodeM writes provider response_json before its canonical assistant_text.
  // Keep recovery text separate until canonical records establish its position.
  // EOF/stop can still expose it without inserting it ahead of later reasoning.
  pendingResponseAssistant: { readonly text: string; readonly at: string } | null
  // An engine turn ended, so the next assistant/reasoning record opens its own
  // segment instead of extending the one the previous engine turn produced.
  segmentBoundaryPending: boolean
  usage: ConversationUsage | null
}

export interface PendingBackgroundDispatch {
  /** Older v10 writers reveal the task id only in the first lifecycle record. */
  readonly label: string
  readonly prompt: string
  readonly source: string
  readonly at: string
}

/** A tool declared in turn_response but not yet observed as an executed call. */
export interface PendingToolDeclaration {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: ToolPayload
  readonly at: string
}

/** UserPromptSubmit hook 先于所属轮次出现，需要缓存到轮次建立后再挂载。 */
export interface PendingTurnHook {
  readonly lineNumber: number
  readonly item: ParsedHookExecution
}

export function createMutableTurn(
  sessionId: string,
  index: number,
  initialSubmission: CodeMTurnInitialSubmission,
  startedAt: string,
  model: string | null,
  provider: string | null,
): MutableConversationTurn {
  return {
    id: `${sessionId}:turn:${index}`,
    index,
    initialSubmission,
    engineTurnIndexes: [],
    engineTurns: [],
    lifecycle: activeTurnLifecycle('running'),
    model,
    provider,
    startedAt,
    items: [],
    pendingToolDeclarations: new Map(),
    pendingFinalAnswers: new Map(),
    pendingBackgroundDispatches: [],
    pendingResponseAssistant: null,
    segmentBoundaryPending: false,
    usage: null,
  }
}

export function appendHookExecution(
  turn: MutableConversationTurn,
  hook: PendingTurnHook,
): void {
  turn.items.push({
    id: `${turn.id}:hook:${hook.lineNumber}`,
    ...hook.item,
  })
}

export function requireCurrentTurn(
  turn: MutableConversationTurn | null,
  path: string,
  lineNumber: number,
  recordLabel: string,
): MutableConversationTurn {
  if (!turn) {
    throw sessionFileError(
      path,
      lineNumber,
      `${recordLabel} appears before the first user message`,
    )
  }
  return turn
}

export function freezeTurn(
  turn: MutableConversationTurn,
): ConversationTurn {
  return {
    id: turn.id,
    index: turn.index,
    engineTurnIndexes: turn.engineTurnIndexes,
    model: turn.model,
    provider: turn.provider,
    startedAt: turn.startedAt,
    items: projectedTurnItems(turn),
    usage: turn.usage,
    ...turn.lifecycle,
  }
}

/** Projection-only recovery at EOF must not consume the incremental reducer state. */
export function projectedTurnItems(turn: MutableConversationTurn): readonly ConversationItem[] {
  const pending = turn.pendingResponseAssistant
  return pending
    ? appendConversationAssistantText(turn.items, turn.id, pending.text, pending.at, turn.segmentBoundaryPending)
    : turn.items
}

/** Once execution or a terminal record follows, missing canonical text is recovered here. */
export function commitResponseAssistant(turn: MutableConversationTurn): void {
  if (!turn.pendingResponseAssistant) return
  const items = projectedTurnItems(turn)
  turn.items.splice(0, turn.items.length, ...items)
  turn.pendingResponseAssistant = null
  turn.segmentBoundaryPending = false
}

export function registerEngineTurnIndex(
  turn: MutableConversationTurn,
  turnIndex: number,
  lineNumber: number,
): void {
  rememberEngineTurnIndex(turn, turnIndex)
  if (turn.engineTurns.some((engineTurn) => engineTurn.turnIndex === turnIndex)) {
    return
  }
  appendEngineTurn(turn, turnIndex, lineNumber)
}

/** Every turn_request starts a request occurrence, even when one user turn's
 * tool loop reuses the same durable turn_index across multiple model calls. */
export function openEngineTurn(
  turn: MutableConversationTurn,
  turnIndex: number,
  lineNumber: number,
): void {
  rememberEngineTurnIndex(turn, turnIndex)
  appendEngineTurn(turn, turnIndex, lineNumber)
}

function rememberEngineTurnIndex(
  turn: MutableConversationTurn,
  turnIndex: number,
): void {
  if (!turn.engineTurnIndexes.includes(turnIndex)) {
    turn.engineTurnIndexes.push(turnIndex)
  }
}

function appendEngineTurn(
  turn: MutableConversationTurn,
  turnIndex: number,
  lineNumber: number,
): void {
  turn.engineTurns.push({
    turnIndex,
    requestLine: lineNumber,
    endLine: null,
    stopReason: null,
    lifecycle: 'open',
  })
}

// Closes the most recently opened engine turn with the durable stop reason. A
// `tool-use` boundary also ends its engine turn; the next `turn_request` opens a
// fresh one, so an engine turn maps one-to-one to a `turn_request`/`turn_end`
// pair even within a multi-round conversation turn.
export function endCurrentEngineTurn(
  turn: MutableConversationTurn,
  lineNumber: number,
  stopReason: AgentDurableTurnStopReason,
): void {
  const open = turn.engineTurns.findLast(
    (engineTurn) => engineTurn.lifecycle === 'open',
  )
  if (!open) return
  open.endLine = lineNumber
  open.stopReason = stopReason
  open.lifecycle = 'ended'
}

export function applyError(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const at = requireTimestamp(record.at, path, lineNumber, 'at')
  commitResponseAssistant(turn)
  turn.lifecycle = terminalTurnLifecycle('failed', at)
  turn.items.push({
    id: `${turn.id}:error:${lineNumber}`,
    kind: 'error',
    cause: 'runtime',
    text: requireNonEmptyString(record.message, path, lineNumber, 'message'),
    at,
  })
}

export function applyUsage(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  turn.usage = addConversationUsage(turn.usage, {
    inputTokens: requireNullableNumber(
      record.input_tokens,
      path,
      lineNumber,
      'input_tokens',
    ),
    outputTokens: requireNullableNumber(
      record.output_tokens,
      path,
      lineNumber,
      'output_tokens',
    ),
    cacheReadTokens: requireNullableNumber(
      record.cache_read,
      path,
      lineNumber,
      'cache_read',
    ),
    cacheCreationTokens: requireNullableNumber(
      record.cache_creation,
      path,
      lineNumber,
      'cache_creation',
    ),
  })
}

export function applyTurnEnd(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber, durableSequenceRequired }: TurnRecordContext,
): void {
  if (record.turn_index !== undefined && durableSequenceRequired) {
    const turnIndex = requireNonNegativeInteger(
      record.turn_index,
      path,
      lineNumber,
      'turn_index',
    )
    const open = turn.engineTurns.findLast(
      (engineTurn) => engineTurn.lifecycle === 'open',
    )
    if (!open || open.turnIndex !== turnIndex) {
      throw sessionFileError(
        path,
        lineNumber,
        `turn_end turn_index ${turnIndex} does not match the open engine turn`,
      )
    }
  }
  const persisted = decodePersistedTurnStopReason(record.stop_reason, path, lineNumber)
  endCurrentEngineTurn(turn, lineNumber, durableTurnStopReason(persisted))
  commitResponseAssistant(turn)
  turn.segmentBoundaryPending = true
  const stopReason = canonicalTurnStopReason(persisted)
  switch (stopReason.kind) {
    case 'tool-use':
      turn.lifecycle = activeTurnLifecycle('running')
      return
    case 'end-turn':
    case 'max-tokens':
      markPlainFinalDelivery(turn)
      turn.lifecycle = terminalTurnLifecycle(
        'completed',
        requireTimestamp(record.at, path, lineNumber, 'at'),
      )
      return
    case 'cancelled':
      turn.lifecycle = terminalTurnLifecycle(
        'stopped',
        requireTimestamp(record.at, path, lineNumber, 'at'),
      )
      return
    case 'failed': {
      const at = requireTimestamp(record.at, path, lineNumber, 'at')
      turn.lifecycle = terminalTurnLifecycle('failed', at)
      turn.items.push({
        id: `${turn.id}:error:${lineNumber}`,
        kind: 'error',
        cause: stopReason.cause,
        text: stopReason.reason,
        at,
      })
    }
  }
}

function markPlainFinalDelivery(turn: MutableConversationTurn): void {
  const finalIndex = turn.items.findLastIndex(
    (item) => item.kind === 'message' && item.role === 'assistant',
  )
  const finalItem = turn.items[finalIndex]
  if (
    finalIndex < 0 ||
    finalItem?.kind !== 'message' ||
    finalItem.role !== 'assistant' ||
    finalItem.delivery !== null
  ) return
  turn.items[finalIndex] = {
    ...finalItem,
    delivery: { synthetic: false, structured: null },
  }
}

/**
 * JSON-serializable snapshot of the single open turn (design §7.2 reducer
 * context). Arrays are copied so the live turn can keep mutating after a
 * checkpoint; the `pendingToolDeclarations` map is flattened to entries. Its
 * size is bounded by one turn, never by the session length.
 */
export interface SerializedMutableTurn {
  readonly id: string
  readonly index: number
  readonly initialSubmission: CodeMTurnInitialSubmission
  readonly engineTurnIndexes: readonly number[]
  readonly engineTurns: readonly EngineTurnSource[]
  readonly lifecycle: ConversationTurnLifecycle
  readonly model: string | null
  readonly provider: string | null
  readonly startedAt: string
  readonly items: readonly ConversationItem[]
  readonly pendingToolDeclarations: readonly (readonly [
    string,
    PendingToolDeclaration,
  ])[]
  readonly pendingFinalAnswers: readonly (readonly [
    string,
    FinalAnswerStructured,
  ])[]
  readonly pendingBackgroundDispatches: readonly PendingBackgroundDispatch[]
  readonly pendingResponseAssistant: MutableConversationTurn['pendingResponseAssistant']
  readonly segmentBoundaryPending: boolean
  readonly usage: ConversationUsage | null
}

export function serializeMutableTurn(
  turn: MutableConversationTurn,
): SerializedMutableTurn {
  return {
    id: turn.id,
    index: turn.index,
    initialSubmission: turn.initialSubmission,
    engineTurnIndexes: [...turn.engineTurnIndexes],
    engineTurns: turn.engineTurns.map((engineTurn) => ({ ...engineTurn })),
    lifecycle: { ...turn.lifecycle },
    model: turn.model,
    provider: turn.provider,
    startedAt: turn.startedAt,
    items: [...turn.items],
    pendingToolDeclarations: [...turn.pendingToolDeclarations.entries()].map(
      ([toolCallId, declaration]) => [toolCallId, { ...declaration }] as const,
    ),
    pendingFinalAnswers: [...turn.pendingFinalAnswers.entries()].map(
      ([toolCallId, finalAnswer]) => [toolCallId, finalAnswer] as const,
    ),
    pendingBackgroundDispatches: turn.pendingBackgroundDispatches.map(
      (dispatch) => ({ ...dispatch }),
    ),
    pendingResponseAssistant: turn.pendingResponseAssistant ? { ...turn.pendingResponseAssistant } : null,
    segmentBoundaryPending: turn.segmentBoundaryPending,
    usage: turn.usage ? { ...turn.usage } : null,
  }
}

export function restoreMutableTurn(
  serialized: SerializedMutableTurn,
): MutableConversationTurn {
  return {
    id: serialized.id,
    index: serialized.index,
    initialSubmission: serialized.initialSubmission,
    engineTurnIndexes: [...serialized.engineTurnIndexes],
    engineTurns: serialized.engineTurns.map((engineTurn) => ({ ...engineTurn })),
    lifecycle: { ...serialized.lifecycle },
    model: serialized.model,
    provider: serialized.provider,
    startedAt: serialized.startedAt,
    items: [...serialized.items],
    pendingToolDeclarations: new Map(
      serialized.pendingToolDeclarations.map(
        ([toolCallId, declaration]) => [toolCallId, { ...declaration }],
      ),
    ),
    pendingFinalAnswers: new Map(serialized.pendingFinalAnswers),
    pendingResponseAssistant: serialized.pendingResponseAssistant ? { ...serialized.pendingResponseAssistant } : null,
    segmentBoundaryPending: serialized.segmentBoundaryPending,
    pendingBackgroundDispatches: serialized.pendingBackgroundDispatches.map(
      (dispatch) => ({ ...dispatch }),
    ),
    usage: serialized.usage ? { ...serialized.usage } : null,
  }
}
