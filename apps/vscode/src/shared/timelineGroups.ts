import type { ActivityMessage, ChatMessage } from "./messages.ts"

type WorkMessage = ActivityMessage | (ChatMessage & { role: "assistant" })

export type TimelineGroup = { kind: "message"; message: ChatMessage } | { kind: "work"; id: string; messages: readonly WorkMessage[]; hasResult: boolean }

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
  const workByTurn = new Map<string | undefined, { kind: "work"; id: string; messages: WorkMessage[]; hasResult: boolean }>()
  const resultTurns = new Set<string | undefined>()
  for (const message of messages) {
    if (message.role === "tool" || message.role === "reasoning" || message.role === "assistant" && progress.has(message.id)) {
      let work = workByTurn.get(message.turnId)
      if (!work) {
        work = { kind: "work", id: message.id, messages: [], hasResult: resultTurns.has(message.turnId) }
        workByTurn.set(message.turnId, work)
        result.push(work)
      }
      work.messages.push(message.role === "tool" || message.role === "reasoning" ? message : { ...message, role: "assistant" })
    } else {
      // A new user submission also separates records that do not yet have a Core turn ID.
      if (message.role === "user") { workByTurn.clear(); resultTurns.clear() }
      if (message.role === "assistant" && (message.text.trim() || message.artifacts?.length)) {
        resultTurns.add(message.turnId)
        const work = workByTurn.get(message.turnId)
        if (work) work.hasResult = true
      }
      result.push({ kind: "message", message })
    }
  }
  return result
}
