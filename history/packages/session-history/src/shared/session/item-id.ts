import type { ConversationItem, FileDiffSource } from "./model.ts"

export function conversationFileDiffItemId(
  turnId: string,
  source: FileDiffSource,
  path: string,
): string {
  const sourceId = source.kind === 'tool'
    ? `tool:${encodeURIComponent(source.toolCallId)}`
    : source.kind === 'background-tool'
      ? `background-tool:${encodeURIComponent(source.backgroundTaskId)}:${encodeURIComponent(source.toolCallId)}`
      : `checkpoint:${encodeURIComponent(source.checkpointId)}`
  return `${turnId}:diff:${sourceId}:${encodeURIComponent(path)}`
}

export function assistantSegmentItemId(
  turnId: string,
  items: readonly ConversationItem[],
): string {
  return segmentItemId(
    turnId,
    'assistant',
    items.filter(
      (item) =>
        item.kind === 'message' &&
        item.role === 'assistant' &&
        segmentIdBelongsToTurn(item.id, turnId, 'assistant'),
    ).length,
  )
}

export function reasoningSegmentItemId(
  turnId: string,
  items: readonly ConversationItem[],
): string {
  return segmentItemId(
    turnId,
    'reasoning',
    items.filter(
      (item) =>
        item.kind === 'activity' &&
        item.activityType === 'reasoning' &&
        segmentIdBelongsToTurn(item.id, turnId, 'reasoning'),
    ).length,
  )
}

function segmentIdBelongsToTurn(
  itemId: string,
  turnId: string,
  kind: 'assistant' | 'reasoning',
): boolean {
  const base = `${turnId}:${kind}`
  return itemId === base || itemId.startsWith(`${base}:`)
}

function segmentItemId(turnId: string, kind: string, index: number): string {
  return index === 0 ? `${turnId}:${kind}` : `${turnId}:${kind}:${index}`
}
