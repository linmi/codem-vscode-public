import { assistantSegmentItemId } from "./item-id.ts"
import type { ConversationItem } from "./model.ts"

type ConversationAssistantItem = Extract<
  ConversationItem,
  { kind: 'message'; role: 'assistant' }
>

export function appendConversationAssistantText(
  items: readonly ConversationItem[],
  turnId: string,
  text: string,
  at: string,
  startSegment: boolean,
): readonly ConversationItem[] {
  const deliveryCleared = clearActiveConversationAssistantDeliveries(items)
  const previous = deliveryCleared.at(-1)
  if (!startSegment && isConversationAssistantSegment(previous, turnId)) {
    const next = deliveryCleared.slice()
    next[next.length - 1] = {
      ...previous,
      text: `${previous.text}${text}`,
      at,
    }
    return next
  }
  return [
    ...deliveryCleared,
    {
      id: assistantSegmentItemId(turnId, deliveryCleared),
      kind: 'message',
      role: 'assistant',
      text,
      delivery: null,
      at,
    },
  ]
}

export function isConversationAssistantSegment(
  item: ConversationItem | undefined,
  turnId: string,
): item is ConversationAssistantItem {
  return Boolean(
    item &&
      item.kind === 'message' &&
      item.role === 'assistant' &&
      (item.id === `${turnId}:assistant` ||
        item.id.startsWith(`${turnId}:assistant:`)),
  )
}

export function clearActiveConversationAssistantDeliveries(
  items: readonly ConversationItem[],
): readonly ConversationItem[] {
  const activeConversationStart = items.findLastIndex((item) =>
    item.kind === 'message' && item.role === 'user',
  )
  let next: ConversationItem[] | null = null
  for (
    let index = activeConversationStart + 1;
    index < items.length;
    index += 1
  ) {
    const item = items[index]
    if (
      item?.kind === 'message' &&
      item.role === 'assistant' &&
      item.delivery !== null
    ) {
      next ??= items.slice()
      next[index] = { ...item, delivery: null }
    }
  }
  return next ?? items
}
