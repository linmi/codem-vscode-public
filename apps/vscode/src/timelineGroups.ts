import type { ActivityMessage, ChatMessage } from "./messages.ts"

export type TimelineGroup = { kind: "message"; message: ChatMessage } | { kind: "work"; id: string; messages: readonly ActivityMessage[] }

/** Fold only adjacent execution records; every user/assistant message stays in order outside. */
export function timelineGroups(messages: readonly ChatMessage[]): TimelineGroup[] {
  const result: TimelineGroup[] = []
  let work: { kind: "work"; id: string; messages: ActivityMessage[] } | null = null
  for (const message of messages) {
    if (message.role === "tool" || message.role === "reasoning") {
      if (!work || work.messages[0]!.turnId !== message.turnId) {
        work = { kind: "work", id: message.id, messages: [] }
        result.push(work)
      }
      work.messages.push(message)
    } else {
      result.push({ kind: "message", message })
      work = null
    }
  }
  return result
}
