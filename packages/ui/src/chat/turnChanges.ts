import type { ChatMessage, DiffView } from "../contract.ts"

export interface TurnChangeGroup {
  turnId: string
  afterMessageId: string | null
  files: readonly DiffView[]
}

/** 变更跟在该轮最后一条消息后面。停止或后一轮不能把差异改派到别的轮次。 */
export function turnChanges(messages: readonly ChatMessage[], diffs: readonly DiffView[]): TurnChangeGroup[] {
  const lastMessage = new Map<string, string>()
  for (const message of messages) if (message.turnId) lastMessage.set(message.turnId, message.id)
  const groups = new Map<string, TurnChangeGroup>()
  for (const diff of diffs) {
    if (!diff.turnId) continue
    const group = groups.get(diff.turnId)
    if (group) groups.set(diff.turnId, { ...group, files: [...group.files, diff] })
    else groups.set(diff.turnId, { turnId: diff.turnId, afterMessageId: lastMessage.get(diff.turnId) ?? null, files: [diff] })
  }
  return [...groups.values()]
}
