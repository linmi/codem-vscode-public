import type { ConversationItem } from "./model.ts"
import { reasoningSegmentItemId } from "./item-id.ts"

export const REDACTED_REASONING_TEXT = 'Reasoning content is redacted.'

export type ConversationReasoningBlock =
  | { readonly kind: 'visible'; readonly text: string }
  | { readonly kind: 'redacted' }

export function appendConversationReasoning(
  items: readonly ConversationItem[],
  turnId: string,
  block: ConversationReasoningBlock,
  at: string,
  startSegment: boolean,
): readonly ConversationItem[] {
  const previous = items.at(-1)
  if (
    block.kind === 'visible' &&
    !startSegment &&
    isVisibleReasoning(previous, turnId)
  ) {
    const next = items.slice()
    next[next.length - 1] = {
      ...previous,
      text: `${previous.text}${block.text}`,
      at,
    }
    return next
  }
  return [
    ...items,
    block.kind === 'visible'
      ? {
          id: reasoningSegmentItemId(turnId, items),
          kind: 'activity',
          activityType: 'reasoning',
          text: block.text,
          redacted: false,
          at,
        }
      : {
          id: reasoningSegmentItemId(turnId, items),
          kind: 'activity',
          activityType: 'reasoning',
          text: REDACTED_REASONING_TEXT,
          redacted: true,
          at,
        },
  ]
}

function isVisibleReasoning(
  item: ConversationItem | undefined,
  turnId: string,
): item is Extract<
  ConversationItem,
  { kind: 'activity'; activityType: 'reasoning'; redacted: false }
> {
  return Boolean(
    item &&
      item.kind === 'activity' &&
      item.activityType === 'reasoning' &&
      !item.redacted &&
      (item.id === `${turnId}:reasoning` ||
        item.id.startsWith(`${turnId}:reasoning:`)),
  )
}
