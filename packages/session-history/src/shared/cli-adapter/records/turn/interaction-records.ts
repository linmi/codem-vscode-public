import { activeTurnLifecycle } from "../../../session/index.ts"
import {
  parseDurablePermissionDecision,
  parseDurablePermissionRequest,
  parseDurablePlanDecision,
  parseDurablePlanModeDecision,
  parseDurableSteerMode,
} from "../durable-interactions.ts"
import {
  parsePersistedQuestionReply,
  parsePersistedQuestionRequest,
  questionActivityText,
  validatePersistedQuestionReply,
} from "../question.ts"
import {
  requireNonEmptyString,
  requireTimestamp,
} from "../fields.ts"
import { sessionFileError } from "../jsonl.ts"
import type { MutableConversationTurn } from "./model.ts"
import type { TurnRecordContext } from "./records.ts"

export function applyPermissionRequested(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const request = parseDurablePermissionRequest(record.request, path, lineNumber)
  const id = `${turn.id}:permission:${request.requestId}`
  if (turn.items.some((item) => item.id === id)) {
    throw sessionFileError(path, lineNumber, `duplicate permission request ${request.requestId}`)
  }
  const permission = {
    id,
    kind: 'activity' as const,
    activityType: 'permission' as const,
    text: `等待权限确认：${request.toolName}`,
    request,
    toolAssociation: turn.items.some(
      (item) => item.kind === 'tool-execution' && item.toolCallId === request.toolCallId,
    ) ? 'associated' as const : 'unassociated' as const,
    decision: null,
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  }
  const toolIndex = turn.items.findIndex(
    (item) => item.kind === 'tool-execution' && item.toolCallId === request.toolCallId,
  )
  if (toolIndex < 0) turn.items.push(permission)
  else turn.items.splice(toolIndex, 0, permission)
  turn.lifecycle = activeTurnLifecycle('waiting-interaction')
}

export function applyPermissionDecided(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const requestId = requireNonEmptyString(record.request_id, path, lineNumber, 'request_id')
  const toolCallId = requireNonEmptyString(record.tool_call_id, path, lineNumber, 'tool_call_id')
  const index = turn.items.findIndex((item) => item.id === `${turn.id}:permission:${requestId}`)
  const item = turn.items[index]
  if (!item || item.kind !== 'activity' || item.activityType !== 'permission') {
    throw sessionFileError(path, lineNumber, `permission decision ${requestId} has no request`)
  }
  if (item.request.toolCallId !== toolCallId) {
    throw sessionFileError(
      path,
      lineNumber,
      `permission decision ${requestId} tool_call_id ${toolCallId} does not match ${item.request.toolCallId}`,
    )
  }
  turn.items[index] = {
    ...item,
    decision: parseDurablePermissionDecision(record.decision, path, lineNumber),
  }
  turn.lifecycle = activeTurnLifecycle('running')
}

export function applyPlanApprovalRequested(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const requestId = requireNonEmptyString(record.tool_call_id, path, lineNumber, 'tool_call_id')
  const plan = requireNonEmptyString(record.plan, path, lineNumber, 'plan')
  const id = `${turn.id}:plan:${requestId}`
  if (turn.items.some((item) => item.id === id)) {
    throw sessionFileError(path, lineNumber, `duplicate plan approval request ${requestId}`)
  }
  turn.items.push({
    id,
    kind: 'activity',
    activityType: 'plan',
    text: plan,
    request: { requestId, plan },
    decision: null,
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  })
  turn.lifecycle = activeTurnLifecycle('waiting-interaction')
}

export function applyPlanApprovalDecided(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const requestId = requireNonEmptyString(record.tool_call_id, path, lineNumber, 'tool_call_id')
  settleDurableInteraction(
    turn,
    `${turn.id}:plan:${requestId}`,
    'plan',
    parseDurablePlanDecision(record.decision, path, lineNumber),
    path,
    lineNumber,
  )
}

export function applyPlanModeRequested(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const requestId = requireNonEmptyString(record.tool_call_id, path, lineNumber, 'tool_call_id')
  const reason = requireNonEmptyString(record.reason, path, lineNumber, 'reason')
  const id = `${turn.id}:plan-mode:${requestId}`
  if (turn.items.some((item) => item.id === id)) {
    throw sessionFileError(path, lineNumber, `duplicate plan mode request ${requestId}`)
  }
  turn.items.push({
    id,
    kind: 'activity',
    activityType: 'plan-mode',
    text: `Codem 请求进入计划模式：${reason}`,
    requestId,
    decision: null,
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  })
  turn.lifecycle = activeTurnLifecycle('waiting-interaction')
}

export function applyPlanModeDecided(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const requestId = requireNonEmptyString(record.tool_call_id, path, lineNumber, 'tool_call_id')
  settleDurableInteraction(
    turn,
    `${turn.id}:plan-mode:${requestId}`,
    'plan-mode',
    parseDurablePlanModeDecision(record.decision, path, lineNumber),
    path,
    lineNumber,
  )
}

function settleDurableInteraction(
  turn: MutableConversationTurn,
  id: string,
  activityType: 'plan' | 'plan-mode',
  decision: ReturnType<typeof parseDurablePlanDecision> | ReturnType<typeof parseDurablePlanModeDecision>,
  path: string,
  lineNumber: number,
): void {
  const index = turn.items.findIndex((item) => item.id === id)
  const item = turn.items[index]
  if (!item || item.kind !== 'activity' || item.activityType !== activityType) {
    throw sessionFileError(path, lineNumber, `${activityType} decision ${id} has no request`)
  }
  if (activityType === 'plan') {
    if (item.activityType !== 'plan' || typeof decision === 'string') {
      throw sessionFileError(path, lineNumber, `invalid plan decision ${id}`)
    }
    turn.items[index] = { ...item, decision }
  } else {
    if (item.activityType !== 'plan-mode' || typeof decision !== 'string') {
      throw sessionFileError(path, lineNumber, `invalid plan mode decision ${id}`)
    }
    turn.items[index] = { ...item, decision }
  }
  turn.lifecycle = activeTurnLifecycle('running')
}

export function applySteerAccepted(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const text = requireNonEmptyString(record.text, path, lineNumber, 'text')
  turn.items.push({
    id: `${turn.id}:steer:record-${lineNumber}`,
    kind: 'activity',
    activityType: 'steer',
    requestId: `record-${lineNumber}`,
    text,
    result: 'accepted',
    mode: parseDurableSteerMode(record.mode, path, lineNumber),
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  })
}

export function applyQuestionAsked(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const request = parsePersistedQuestionRequest(record, path, lineNumber)
  turn.lifecycle = activeTurnLifecycle('waiting-interaction')
  turn.items.push({
    id: `${turn.id}:question:${request.requestId}`,
    kind: 'activity',
    activityType: 'question',
    text: questionActivityText(request),
    request,
    reply: null,
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  })
}

export function applyQuestionAnswered(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const requestId = requireNonEmptyString(record.request_id, path, lineNumber, 'request_id')
  const id = `${turn.id}:question:${requestId}`
  const itemIndex = turn.items.findIndex((item) => item.id === id)
  const item = turn.items[itemIndex]
  if (!item || item.kind !== 'activity' || item.activityType !== 'question') {
    throw sessionFileError(path, lineNumber, `question answer ${requestId} has no request`)
  }
  const reply = parsePersistedQuestionReply(record.reply, path, lineNumber)
  validatePersistedQuestionReply(item.request, reply, path, lineNumber)
  turn.items[itemIndex] = { ...item, reply }
  turn.lifecycle = activeTurnLifecycle('running')
}
