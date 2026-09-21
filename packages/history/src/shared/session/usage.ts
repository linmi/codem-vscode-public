import type { ConversationUsage } from "./model.ts"

export function addConversationUsage(
  left: ConversationUsage | null,
  right: ConversationUsage | null,
): ConversationUsage | null {
  if (!right) return left
  if (!left) return right
  return {
    inputTokens: addNullableCounts(left.inputTokens, right.inputTokens),
    outputTokens: addNullableCounts(left.outputTokens, right.outputTokens),
    cacheReadTokens: addNullableCounts(left.cacheReadTokens, right.cacheReadTokens),
    cacheCreationTokens: addNullableCounts(
      left.cacheCreationTokens,
      right.cacheCreationTokens,
    ),
  }
}

function addNullableCounts(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0)
}
