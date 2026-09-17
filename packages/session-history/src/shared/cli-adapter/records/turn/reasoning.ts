import {
  appendConversationReasoning,
  type ConversationReasoningBlock,
} from "../../../session/index.ts"
import {
  nullableString,
  requireNonEmptyString,
  requireTimestamp,
} from "../fields.ts"
import type { MutableConversationTurn } from "./model.ts"
import type { TurnRecordContext } from "./records.ts"

export function applyReasoning(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const text = requireNonEmptyString(
    record.text ?? record.content,
    path,
    lineNumber,
    record.text === undefined ? 'content' : 'text',
  )
  const at = requireTimestamp(record.at, path, lineNumber, 'at')
  nullableString(
    record.signature,
    path,
    lineNumber,
    'signature',
  )
  appendDecodedReasoning(turn, { kind: 'visible', text }, at)
}

export function appendDecodedReasoning(
  turn: MutableConversationTurn,
  block: ConversationReasoningBlock,
  at: string,
): void {
  const items = appendConversationReasoning(
    turn.items,
    turn.id,
    block,
    at,
    turn.segmentBoundaryPending,
  )
  turn.items.splice(0, turn.items.length, ...items)
  turn.segmentBoundaryPending = false
}
