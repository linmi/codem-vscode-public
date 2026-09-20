import type { ChatMessage, DiffView } from "./messages.ts"

export interface TurnChanges { turnId: string; afterMessageId: string | null; files: readonly DiffView[] }
/** Core identity owns grouping; a stop, missing final reply or a later turn cannot reassign a diff. */
export function turnChanges(messages: readonly ChatMessage[], diffs: readonly DiffView[]): TurnChanges[] {
  const lastMessage = new Map<string, string>()
  for (const message of messages) if (message.turnId) lastMessage.set(message.turnId, message.id)
  const groups = new Map<string, TurnChanges>()
  for (const diff of diffs) {
    const group = groups.get(diff.turnId)
    if (group) groups.set(diff.turnId, { ...group, files: [...group.files, diff] })
    else groups.set(diff.turnId, { turnId: diff.turnId, afterMessageId: lastMessage.get(diff.turnId) ?? null, files: [diff] })
  }
  return [...groups.values()]
}
