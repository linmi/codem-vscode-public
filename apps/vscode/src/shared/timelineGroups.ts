import type { ActivityMessage, ChatMessage } from "./messages.ts"

export type TimelineGroup = { kind: "message"; message: ChatMessage } | { kind: "work"; id: string; messages: readonly ActivityMessage[] }

/** One execution disclosure per turn, anchored at its first activity. All replies remain visible. */
export function timelineGroups(messages: readonly ChatMessage[]): TimelineGroup[] {
  const result: TimelineGroup[] = []
  const workByTurn = new Map<string | undefined, { kind: "work"; id: string; messages: ActivityMessage[] }>()
  for (const message of messages) {
    if (message.role === "tool" || message.role === "reasoning") {
      let work = workByTurn.get(message.turnId)
      if (!work) {
        work = { kind: "work", id: message.id, messages: [] }
        workByTurn.set(message.turnId, work)
        result.push(work)
      }
      work.messages.push(message)
    } else {
      // A new user submission also separates records that do not yet have a Core turn ID.
      if (message.role === "user") workByTurn.clear()
      result.push({ kind: "message", message })
    }
  }
  return result
}
