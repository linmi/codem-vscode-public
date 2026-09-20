import type { ActivityMessage, ChatMessage } from "./messages.ts"

type WorkMessage = ActivityMessage | (ChatMessage & { role: "assistant" })

export type TimelineGroup = { kind: "message"; message: ChatMessage } | { kind: "work"; id: string; messages: readonly WorkMessage[] }

/** Fold intermediate replies with their following work; trailing answers stay outside. */
export function timelineGroups(messages: readonly ChatMessage[]): TimelineGroup[] {
  const progress = new Set<string>()
  const laterWork = new Set<string | undefined>()
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.role === "user") laterWork.clear()
    else if (message.role === "tool" || message.role === "reasoning") laterWork.add(message.turnId)
    else if (laterWork.has(message.turnId) && !message.artifacts?.length) progress.add(message.id)
  }
  const result: TimelineGroup[] = []
  const workByTurn = new Map<string | undefined, { kind: "work"; id: string; messages: WorkMessage[] }>()
  for (const message of messages) {
    if (message.role === "tool" || message.role === "reasoning" || message.role === "assistant" && progress.has(message.id)) {
      let work = workByTurn.get(message.turnId)
      if (!work) {
        work = { kind: "work", id: message.id, messages: [] }
        workByTurn.set(message.turnId, work)
        result.push(work)
      }
      work.messages.push(message.role === "tool" || message.role === "reasoning" ? message : { ...message, role: "assistant" })
    } else {
      // A new user submission also separates records that do not yet have a Core turn ID.
      if (message.role === "user") workByTurn.clear()
      result.push({ kind: "message", message })
    }
  }
  return result
}
