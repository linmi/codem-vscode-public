import type { ChatMessage } from "../contract.ts"

export type WorkMessage = ChatMessage & { role: "assistant" | "reasoning" | "tool" }

export type TimelineGroup =
  | { kind: "message"; message: ChatMessage }
  | { kind: "work"; id: string; messages: readonly WorkMessage[]; hasResult: boolean }

/**
 * 与现网 timelineGroups 相同：中间进度折进后续工作分组，收尾答复留在分组外。
 * 只读 Host 投影 messages，不另存 transcript。
 */
export function timelineGroups(messages: readonly ChatMessage[]): TimelineGroup[] {
  const progress = new Set<string>()
  const laterWork = new Set<string | undefined>()
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.role === "user") laterWork.clear()
    else if (message.role === "tool" || message.role === "reasoning") laterWork.add(message.turnId)
    else if (laterWork.has(message.turnId) && !message.hasArtifacts) progress.add(message.id)
  }
  const result: TimelineGroup[] = []
  const workByTurn = new Map<string | undefined, { kind: "work"; id: string; messages: WorkMessage[]; hasResult: boolean }>()
  const resultTurns = new Set<string | undefined>()
  for (const message of messages) {
    if (message.role === "tool" || message.role === "reasoning" || (message.role === "assistant" && progress.has(message.id))) {
      let work = workByTurn.get(message.turnId)
      if (!work) {
        work = { kind: "work", id: message.id, messages: [], hasResult: resultTurns.has(message.turnId) }
        workByTurn.set(message.turnId, work)
        result.push(work)
      }
      work.messages.push(message as WorkMessage)
    } else {
      if (message.role === "user") {
        workByTurn.clear()
        resultTurns.clear()
      }
      if (message.role === "assistant" && (message.text.trim() || message.hasArtifacts)) {
        resultTurns.add(message.turnId)
        const work = workByTurn.get(message.turnId)
        if (work) work.hasResult = true
      }
      result.push({ kind: "message", message })
    }
  }
  return result
}

export function workGroupState(
  work: readonly WorkMessage[],
  id: string,
  lastActivityId: string | null,
  phase: string,
  hasResult: boolean,
): "running" | "failed" | "interrupted" | "completed" {
  const latestResponse = work.some((message) => message.id === lastActivityId)
  const running = (latestResponse && (phase === "running" || phase === "stopping")) || work.some((message) => message.status === "running")
  if (running) return "running"
  const unresolved = !hasResult
  if (unresolved && work.some((message) => message.status === "failed" || message.status === "incomplete")) return "failed"
  if (unresolved && work.some((message) => message.status === "interrupted" || message.status === "declined")) return "interrupted"
  return "completed"
}

export function lastActivityId(messages: readonly ChatMessage[]): string | null {
  let last: string | null = null
  for (const message of messages) {
    if (message.role === "user") last = null
    else if (message.role === "tool" || message.role === "reasoning") last = message.id
  }
  return last
}
