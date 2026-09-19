import {
  type FinalAnswerStructured,
  type ToolPayload,
  DurableExternalContentSchema,
  createExternalToolPayload,
  appendConversationAssistantText,
  createToolPayload,
  toolGuardText,
} from "../../../session/index.ts"
import { assistantSegmentItemId } from "../../../session/index.ts"
import {
  applyOwnBackgroundLifecycleRecord,
  applyRegisteredBackgroundLifecycleRecord,
  appendBackgroundCompletion,
  appendBackgroundDispatch,
  type BackgroundItemRevisionUpdate,
  type MutableBackgroundLifecycle,
  type BackgroundTaskRegistry,
  type SealedTurnRevisionSink,
} from "../background/model.ts"
import {
  parseBackgroundCompletion,
  type BackgroundCompletion,
} from "../background/completion-index.ts"
import {
  applyCheckpoint,
  applyFileDiff,
  applyGovernanceSnapshot,
} from "./artifact-records.ts"
import { sessionFileError } from "../jsonl.ts"
import {
  applyPermissionDecided,
  applyPermissionRequested,
  applyPlanApprovalDecided,
  applyPlanApprovalRequested,
  applyPlanModeDecided,
  applyPlanModeRequested,
  applyQuestionAnswered,
  applyQuestionAsked,
  applySteerAccepted,
} from "./interaction-records.ts"
import {
  nullableString,
  requireBoolean,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireRecord,
  requireString,
  requireTimestamp,
  summarize,
} from "../fields.ts"
import {
  applyError,
  applyTurnEnd,
  applyUsage,
  type MutableConversationTurn,
  openEngineTurn,
} from "./model.ts"
import {
  activeTurnLifecycle,
  terminalTurnLifecycle,
} from "../../../session/index.ts"
import { parseFinalAnswerStructured } from "../../final-answer.ts"
import { parseToolGuardReport } from "../../tool-guard.ts"
import { applyReasoning } from "./reasoning.ts"

export interface TurnRecordContext {
  readonly path: string
  readonly lineNumber: number
  readonly durableSequenceRequired: boolean
  readonly backgroundTasks: BackgroundTaskRegistry
  readonly backgroundCompletions: ReadonlyMap<string, BackgroundCompletion>
  readonly ownBackgroundTask: {
    readonly taskId: string
    readonly lifecycle: MutableBackgroundLifecycle
  } | null
  // §8.2 sink for a background record whose dispatch turn is already sealed; null on
  // the whole-file parse path (no durable projection to revise).
  readonly reviseSealedTurn:
    | ((
        projectionTurnId: string,
        itemIndex: number,
        update: BackgroundItemRevisionUpdate,
      ) => void)
    | null
}

export interface TurnRecordHandler {
  /** requireCurrentTurn 的错误文案，说明这条记录缺少所属轮次。 */
  readonly label: string
  readonly apply: (
    turn: MutableConversationTurn,
    record: Record<string, unknown>,
    context: TurnRecordContext,
  ) => void
}

/**
 * 只影响当前轮次的已知记录。流级记录（首行 header、user_message、
 * hook_execution）由 canonical 读取状态机自己处理，不在这张表里。
 */
const TURN_RECORD_HANDLERS = new Map<string, TurnRecordHandler>([
  ['turn_request', { label: 'turn request', apply: applyTurnRequest }],
  ['assistant_text', { label: 'assistant text', apply: applyAssistantText }],
  ['thinking', { label: 'thinking', apply: applyReasoning }],
  ['reasoning', { label: 'reasoning', apply: applyReasoning }],
  ['turn_response', { label: 'turn response', apply: applyTurnResponse }],
  ['tool_call', { label: 'tool call', apply: applyToolCall }],
  ['tool_result', { label: 'tool result', apply: applyToolResult }],
  ['file_diff', { label: 'file diff', apply: applyFileDiff }],
  [
    'permission_requested',
    { label: 'permission request', apply: applyPermissionRequested },
  ],
  [
    'permission_decided',
    { label: 'permission decision', apply: applyPermissionDecided },
  ],
  [
    'plan_approval_requested',
    { label: 'plan approval request', apply: applyPlanApprovalRequested },
  ],
  [
    'plan_approval_decided',
    { label: 'plan approval decision', apply: applyPlanApprovalDecided },
  ],
  [
    'plan_mode_requested',
    { label: 'plan mode request', apply: applyPlanModeRequested },
  ],
  [
    'plan_mode_decided',
    { label: 'plan mode decision', apply: applyPlanModeDecided },
  ],
  ['steer_accepted', { label: 'accepted steer', apply: applySteerAccepted }],
  ['user_question_asked', { label: 'user question', apply: applyQuestionAsked }],
  [
    'user_question_answered',
    { label: 'question answer', apply: applyQuestionAnswered },
  ],
  [
    'background_dispatched',
    { label: 'background task', apply: applyBackgroundDispatched },
  ],
  [
    'background_completed',
    { label: 'background result', apply: applyBackgroundCompleted },
  ],
  [
    'background_progress',
    { label: 'background progress', apply: applyBackgroundLifecycle },
  ],
  [
    'background_question',
    { label: 'background question', apply: applyBackgroundLifecycle },
  ],
  [
    'background_replied',
    { label: 'background reply', apply: applyBackgroundLifecycle },
  ],
  [
    'background_cancelled',
    { label: 'background cancellation', apply: applyBackgroundLifecycle },
  ],
  [
    'background_done',
    { label: 'background completion', apply: applyBackgroundLifecycle },
  ],
  ['tool_guard_result', { label: 'tool guard', apply: applyToolGuardResult }],
  [
    'governance_snapshot',
    { label: 'governance snapshot', apply: applyGovernanceSnapshot },
  ],
  ['checkpoint', { label: 'checkpoint', apply: applyCheckpoint }],
  ['error', { label: 'error', apply: applyError }],
  ['usage', { label: 'usage', apply: applyUsage }],
  ['turn_end', { label: 'turn end', apply: applyTurnEnd }],
])

/** 仅返回 Desktop 已知的轮次业务记录；其他记录由流级边界处理。 */
export function turnRecordHandler(type: unknown): TurnRecordHandler | null {
  if (typeof type !== 'string') return null
  return TURN_RECORD_HANDLERS.get(type) ?? null
}

function applyTurnRequest(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  openEngineTurn(
    turn,
    requireNonNegativeInteger(record.turn_index, path, lineNumber, 'turn_index'),
    lineNumber,
  )
  turn.model = nullableString(record.model, path, lineNumber, 'model')
  turn.lifecycle = activeTurnLifecycle('running')
}

function applyAssistantText(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const text = requireNonEmptyString(record.text, path, lineNumber, 'text')
  const at = requireTimestamp(record.at, path, lineNumber, 'at')
  const recoveredItemId = turn.pendingResponseAssistantItemId
  if (recoveredItemId !== null) {
    const recoveredIndex = turn.items.findIndex((item) => item.id === recoveredItemId)
    const recovered = turn.items[recoveredIndex]
    if (
      recoveredIndex < 0 ||
      recovered?.kind !== 'message' ||
      recovered.role !== 'assistant'
    ) {
      throw sessionFileError(
        path,
        lineNumber,
        `recovered assistant response ${recoveredItemId} is missing`,
      )
    }
    turn.items[recoveredIndex] = { ...recovered, text, at }
    turn.pendingResponseAssistantItemId = null
    turn.segmentBoundaryPending = false
    return
  }
  appendDecodedAssistantText(turn, text, at)
}

function appendDecodedAssistantText(
  turn: MutableConversationTurn,
  text: string,
  at: string,
): void {
  const items = appendConversationAssistantText(
    turn.items,
    turn.id,
    text,
    at,
    turn.segmentBoundaryPending,
  )
  turn.items.splice(0, turn.items.length, ...items)
  turn.segmentBoundaryPending = false
}

function applyTurnResponse(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  // response_json is deliberately provider-opaque. Tool declarations are an
  // optional capability inside Anthropic-shaped responses; other shapes remain
  // valid audit records and do not affect the canonical transcript.
  const responseJson = record.response_json
  if (
    !responseJson ||
    typeof responseJson !== 'object' ||
    Array.isArray(responseJson)
  ) {
    return
  }
  const response = responseJson as Record<string, unknown>
  if (!Array.isArray(response.content)) return
  const at = requireTimestamp(record.at, path, lineNumber, 'at')
  const responseText = response.content.flatMap((value, contentIndex) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const content = value as Record<string, unknown>
    if (content.type !== 'text') return []
    return [requireNonEmptyString(
      content.text,
      path,
      lineNumber,
      `response_json.content[${contentIndex}].text`,
    )]
  }).join('\n\n')
  if (responseText) {
    if (turn.pendingResponseAssistantItemId !== null) {
      throw sessionFileError(path, lineNumber, 'duplicate pending assistant response')
    }
    appendDecodedAssistantText(turn, responseText, at)
    turn.pendingResponseAssistantItemId = turn.items.at(-1)?.id ?? null
  }
  response.content.forEach((value, contentIndex) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const content = value as Record<string, unknown>
    if (content.type !== 'tool_use') return
    const declaration = {
      toolCallId: requireNonEmptyString(
        content.id,
        path,
        lineNumber,
        `response_json.content[${contentIndex}].id`,
      ),
      toolName: requireNonEmptyString(
        content.name,
        path,
        lineNumber,
        `response_json.content[${contentIndex}].name`,
      ),
      input: parsePersistedToolPayload(
        content.input,
        `response_json.content[${contentIndex}].input`,
        path,
        lineNumber,
      ),
      at,
    }
    if (
      turn.pendingToolDeclarations.has(declaration.toolCallId) ||
      turn.items.some(
        (item) => item.id === `${turn.id}:tool:${declaration.toolCallId}`,
      )
    ) {
      throw sessionFileError(
        path,
        lineNumber,
        `duplicate tool declaration ${declaration.toolCallId}`,
      )
    }
    turn.pendingToolDeclarations.set(declaration.toolCallId, declaration)
  })
}

function applyToolCall(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  requireOnlyRecordFields(
    record,
    ['type', 'id', 'name', 'input', 'at'],
    path,
    lineNumber,
    'tool_call',
  )
  const toolCallId = requireNonEmptyString(record.id, path, lineNumber, 'id')
  const id = `${turn.id}:tool:${toolCallId}`
  if (turn.items.some((item) => item.id === id)) {
    throw sessionFileError(path, lineNumber, `duplicate tool call ${toolCallId}`)
  }
  const toolName = requireNonEmptyString(record.name, path, lineNumber, 'name')
  if (toolName === 'dispatch') {
    appendPendingBackgroundDispatch(
      turn,
      record.input,
      record.at,
      path,
      lineNumber,
    )
  }
  const declaration = turn.pendingToolDeclarations.get(toolCallId)
  if (declaration && declaration.toolName !== toolName) {
    throw sessionFileError(
      path,
      lineNumber,
      `tool call ${toolCallId} name ${toolName} does not match declared name ${declaration.toolName}`,
    )
  }
  turn.pendingToolDeclarations.delete(toolCallId)
  if (toolName === 'final_answer') {
    turn.pendingFinalAnswers.set(
      toolCallId,
      parsePersistedFinalAnswer(record.input, toolCallId, path, lineNumber),
    )
  }
  turn.items.push({
    id,
    kind: 'tool-execution',
    toolCallId,
    toolName,
    input: parsePersistedToolPayload(record.input, 'input', path, lineNumber),
    result: null,
    status: 'running',
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  })
}

function applyToolResult(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  requireOnlyRecordFields(
    record,
    ['type', 'id', 'content', 'is_error', 'status', 'external_content', 'at'],
    path,
    lineNumber,
    'tool_result',
  )
  const toolCallId = requireNonEmptyString(record.id, path, lineNumber, 'id')
  const id = `${turn.id}:tool:${toolCallId}`
  const itemIndex = turn.items.findIndex((item) => item.id === id)
  const item = turn.items[itemIndex]
  const status = persistedToolStatus(record, path, lineNumber)
  if (!item || item.kind !== 'tool-execution') {
    const declaration = turn.pendingToolDeclarations.get(toolCallId)
    if (!declaration) {
      throw sessionFileError(
        path,
        lineNumber,
        `tool result ${toolCallId} has no matching tool call`,
      )
    }
    turn.pendingToolDeclarations.delete(toolCallId)
    if (declaration.toolName === 'dispatch') {
      appendPendingBackgroundDispatch(
        turn,
        declaration.input.value,
        record.at,
        path,
        lineNumber,
      )
    }
    turn.items.push({
      id,
      kind: 'tool-execution',
      toolCallId,
      toolName: declaration.toolName,
      input: declaration.input,
      result: parsePersistedToolResultPayload(record, path, lineNumber),
      status,
      at: record.at === undefined
        ? declaration.at
        : requireTimestamp(record.at, path, lineNumber, 'at'),
    })
    if (declaration.toolName === 'final_answer' && status === 'succeeded') {
      appendStructuredFinalAnswer(
        turn,
        parsePersistedFinalAnswer(
          declaration.input.value,
          toolCallId,
          path,
          lineNumber,
        ),
        record.at === undefined
          ? declaration.at
          : requireTimestamp(record.at, path, lineNumber, 'at'),
      )
    }
    return
  }
  const pendingFinalAnswer = turn.pendingFinalAnswers.get(toolCallId)
  turn.pendingFinalAnswers.delete(toolCallId)
  turn.items[itemIndex] = {
    ...item,
    result: parsePersistedToolResultPayload(record, path, lineNumber),
    status,
  }
  if (pendingFinalAnswer && status === 'succeeded') {
    appendStructuredFinalAnswer(
      turn,
      pendingFinalAnswer,
      record.at === undefined
        ? item.at
        : requireTimestamp(record.at, path, lineNumber, 'at'),
    )
  }
}

function persistedToolStatus(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): 'succeeded' | 'failed' | 'declined' | 'interrupted' {
  if (record.status === undefined) {
    return requireBoolean(record.is_error, path, lineNumber, 'is_error')
      ? 'failed'
      : 'succeeded'
  }
  switch (record.status) {
    case 'completed': return 'succeeded'
    case 'failed': return 'failed'
    case 'declined': return 'declined'
    case 'interrupted': return 'interrupted'
    default:
      throw sessionFileError(
        path,
        lineNumber,
        `tool result status is invalid: ${summarize(record.status)}`,
      )
  }
}

function appendStructuredFinalAnswer(
  turn: MutableConversationTurn,
  structured: FinalAnswerStructured,
  at: string,
): void {
  clearAssistantDeliveries(turn)
  turn.segmentBoundaryPending = false
  turn.items.push({
    id: assistantSegmentItemId(turn.id, turn.items),
    kind: 'message',
    role: 'assistant',
    text: structured.summary,
    delivery: { synthetic: true, structured },
    at,
  })
}

function parsePersistedFinalAnswer(
  value: unknown,
  toolCallId: string,
  path: string,
  lineNumber: number,
): FinalAnswerStructured {
  try {
    return parseFinalAnswerStructured(value, `final_answer tool ${toolCallId}`)
  } catch (error: unknown) {
    throw sessionFileError(
      path,
      lineNumber,
      error instanceof Error ? error.message : String(error),
    )
  }
}

function parsePersistedToolPayload(
  value: unknown,
  field: string,
  path: string,
  lineNumber: number,
): ToolPayload {
  try {
    return createToolPayload(value)
  } catch (error: unknown) {
    throw sessionFileError(
      path,
      lineNumber,
      `${field} must be a JSON value: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function parsePersistedToolResultPayload(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): ToolPayload {
  if (record.external_content === undefined) {
    return parsePersistedToolPayload(record.content, 'content', path, lineNumber)
  }
  const external = requireRecord(
    record.external_content,
    path,
    lineNumber,
    'external_content',
  )
  const parsed = DurableExternalContentSchema.safeParse({
    kind: 'durable',
    path: external.path,
    byteSize: external.byte_size,
    contentHash: external.content_hash,
    encoding: external.encoding,
    truncatedInlineBytes: external.truncated_inline_bytes,
  })
  if (!parsed.success) {
    throw sessionFileError(
      path,
      lineNumber,
      `invalid external_content manifest: ${parsed.error.message}`,
    )
  }
  const content = requireString(record.content, path, lineNumber, 'content')
  const inlineBytes = Buffer.byteLength(content, 'utf8')
  if (inlineBytes !== parsed.data.truncatedInlineBytes) {
    throw sessionFileError(
      path,
      lineNumber,
      `external_content truncated_inline_bytes ${parsed.data.truncatedInlineBytes} does not match content bytes ${inlineBytes}`,
    )
  }
  if (parsed.data.truncatedInlineBytes > parsed.data.byteSize) {
    throw sessionFileError(
      path,
      lineNumber,
      'external_content inline projection exceeds the complete body',
    )
  }
  return createExternalToolPayload(content, parsed.data)
}

function requireOnlyRecordFields(
  record: Record<string, unknown>,
  expectedFields: readonly string[],
  path: string,
  lineNumber: number,
  label: string,
): void {
  const expected = new Set(expectedFields)
  const unsupported = Object.keys(record).filter((field) => !expected.has(field))
  if (unsupported.length > 0) {
    throw sessionFileError(
      path,
      lineNumber,
      `${label} contains unsupported fields: ${unsupported.join(', ')}`,
    )
  }
}

function clearAssistantDeliveries(turn: MutableConversationTurn): void {
  for (let index = 0; index < turn.items.length; index += 1) {
    const item = turn.items[index]
    if (
      item?.kind === 'message' &&
      item.role === 'assistant' &&
      item.delivery !== null
    ) {
      turn.items[index] = { ...item, delivery: null }
    }
  }
}

function appendPendingBackgroundDispatch(
  turn: MutableConversationTurn,
  rawInput: unknown,
  rawAt: unknown,
  path: string,
  lineNumber: number,
): void {
  const input = requireRecord(rawInput, path, lineNumber, 'input')
  turn.pendingBackgroundDispatches.push({
    label: requireString(input.label, path, lineNumber, 'input.label'),
    prompt: requireString(input.prompt, path, lineNumber, 'input.prompt'),
    source: summarize(input.agent),
    at: requireTimestamp(rawAt, path, lineNumber, 'at'),
  })
}

function applyBackgroundDispatched(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber, backgroundTasks, backgroundCompletions }: TurnRecordContext,
): void {
  turn.pendingBackgroundDispatches.shift()
  const taskId = requireNonEmptyString(
    record.task_id,
    path,
    lineNumber,
    'task_id',
  )
  appendBackgroundDispatch(
    backgroundTasks,
    turn,
    {
      taskId,
      label: requireString(record.label, path, lineNumber, 'label'),
      prompt: requireString(record.prompt, path, lineNumber, 'prompt'),
      source: summarize(record.source),
      at: requireTimestamp(record.at, path, lineNumber, 'at'),
    },
    backgroundCompletions.get(taskId) ?? null,
    (message) => sessionFileError(path, lineNumber, message),
  )
}

function sealedTurnRevisionSink(
  turn: MutableConversationTurn,
  reviseSealedTurn: TurnRecordContext['reviseSealedTurn'],
): SealedTurnRevisionSink | undefined {
  return reviseSealedTurn
    ? { openTurnId: turn.id, emit: reviseSealedTurn }
    : undefined
}

function applyBackgroundCompleted(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber, backgroundTasks, reviseSealedTurn }: TurnRecordContext,
): void {
  appendBackgroundCompletion(
    backgroundTasks,
    turn,
    parseBackgroundCompletion(record, path, lineNumber),
    (message) => sessionFileError(path, lineNumber, message),
    sealedTurnRevisionSink(turn, reviseSealedTurn),
  )
}

function applyBackgroundLifecycle(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  {
    path,
    lineNumber,
    backgroundTasks,
    backgroundCompletions,
    ownBackgroundTask,
    reviseSealedTurn,
  }: TurnRecordContext,
): void {
  if (
    ownBackgroundTask &&
    applyOwnBackgroundLifecycleRecord(
      ownBackgroundTask.lifecycle,
      ownBackgroundTask.taskId,
      record,
      path,
      lineNumber,
    )
  ) {
    const lifecycle = ownBackgroundTask.lifecycle
    turn.lifecycle = lifecycle.completedAt === null
      ? activeTurnLifecycle(
        lifecycle.state === 'waiting-interaction'
          ? 'waiting-interaction'
          : 'running',
      )
      : terminalTurnLifecycle(
        lifecycle.state === 'stopped'
          ? 'stopped'
          : lifecycle.state === 'failed'
            ? 'failed'
            : 'completed',
        lifecycle.completedAt,
      )
    return
  }
  const taskId = requireNonEmptyString(
    record.task_id,
    path,
    lineNumber,
    'task_id',
  )
  if (!backgroundTasks.has(taskId)) {
    const pending = turn.pendingBackgroundDispatches.shift()
    if (pending) {
      appendBackgroundDispatch(
        backgroundTasks,
        turn,
        { taskId, ...pending },
        backgroundCompletions.get(taskId) ?? null,
        (message) => sessionFileError(path, lineNumber, message),
      )
    }
  }
  applyRegisteredBackgroundLifecycleRecord(
    backgroundTasks,
    record,
    path,
    lineNumber,
    sealedTurnRevisionSink(turn, reviseSealedTurn),
  )
}

function applyToolGuardResult(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber, durableSequenceRequired }: TurnRecordContext,
): void {
  const report = parseToolGuardReport(
    record.report,
    (message) => sessionFileError(
      path,
      lineNumber,
      `tool_guard_result.report${message.startsWith('.') ? '' : ' '}${message}`,
    ),
  )
  const toolCallId = record.tool_call_id === undefined && !durableSequenceRequired
    ? report.toolCallId
    : requireNonEmptyString(
        record.tool_call_id,
        path,
        lineNumber,
        'tool_call_id',
      )
  if (report.toolCallId !== toolCallId) {
    throw sessionFileError(
      path,
      lineNumber,
      `tool guard tool_call_id ${toolCallId} does not match report`,
    )
  }
  turn.items.push({
    id: `${turn.id}:guard:${toolCallId}`,
    kind: 'activity',
    activityType: 'guard',
    text: toolGuardText(report),
    report,
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  })
}
