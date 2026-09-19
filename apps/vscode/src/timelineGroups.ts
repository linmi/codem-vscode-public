import type { ChatMessage } from "./messages.ts"

export type TimelineGroup = { kind: "message"; message: ChatMessage } | { kind: "work"; id: string; messages: readonly ChatMessage[] }

/** One user response has one execution disclosure, including interleaved progress updates. */
export function timelineGroups(messages: readonly ChatMessage[]): TimelineGroup[] {
  const result: TimelineGroup[] = []
  for (let index = 0; index < messages.length;) {
    const first = messages[index]!
    if (first.role === "user") { result.push({ kind: "message", message: first }); index++; continue }
    const response: ChatMessage[] = []
    while (index < messages.length && messages[index]!.role !== "user") response.push(messages[index++]!)
    if (!response.some(message => "status" in message)) {
      result.push(...response.map(message => ({ kind: "message" as const, message })))
      continue
    }
    // Host places an explicit final answer after the execution items. A trailing
    // text reply also remains visible for runtimes that finish without final_answer.
    const last = response.at(-1)!
    const answer = last.role === "assistant" ? response.pop()! : null
    result.push({ kind: "work", id: first.id, messages: response })
    if (answer) result.push({ kind: "message", message: answer })
  }
  return result
}
