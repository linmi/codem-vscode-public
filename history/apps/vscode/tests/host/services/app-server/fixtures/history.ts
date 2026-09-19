import type { ConversationItem, HistoryTurn } from "@codem/session-history"
const at = "2026-09-15T00:00:00.000Z"
function payload(value: string | Record<string, string>) {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return {
    value,
    preview: text.length > 4000 ? text.slice(0, 4000) + "\n…" : text,
    previewTruncated: text.length > 4000,
  }
}
export function historyTool(n = 1, output = "accepted"): Extract<ConversationItem, { kind: "tool-execution" }> {
  return {
    id: `tool-${n}`,
    kind: "tool-execution",
    toolCallId: `call-${n}`,
    toolName: "final_answer",
    at,
    input: payload({ kind: "chat", status: "complete", summary: `summary ${n}` }),
    result: payload(output),
    status: "succeeded",
  }
}
export function historyTurn(n = 1, completedAt: string | null = "2026-09-15T00:00:01.000Z"): HistoryTurn {
  return {
    submissionId: `submission-${n}`,
    turn: {
      id: `turn-${n}`,
      index: n - 1,
      engineTurnIndexes: [n - 1],
      model: null,
      provider: null,
      startedAt: at,
      usage: null,
      ...(completedAt === null ? { state: "running", completedAt: null } : { state: "completed", completedAt }),
      items: [
        { id: `user-${n}`, kind: "message", role: "user", text: `question ${n}`, at, attachments: [] },
        { id: `answer-${n}`, kind: "message", role: "assistant", text: `answer ${n}`, at, delivery: null },
        historyTool(n),
      ],
    },
  }
}
