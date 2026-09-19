import { toolPayloadText, type SessionHistoryPage } from "@codem/session-history"
import type { ChatMessage } from "./messages.ts"

/** Project durable history into display text. Raw records and host handles never cross this boundary. */
export function historyMessages(threadId: string, page: SessionHistoryPage): ChatMessage[] {
  return page.turns.flatMap(({ turn }) => turn.items.flatMap((item): ChatMessage[] => {
    const id = `history:${threadId}:${turn.index}:${item.id}`
    if (item.kind === "message") {
      const text = item.role === "user" && item.attachments.length ? `${item.text}${item.text ? "\n" : ""}[${item.attachments.length} 个历史附件]` : item.text
      return [{ id, role: item.role, label: item.role === "user" ? "你" : "CodeM", text }]
    }
    if (item.kind === "tool-execution") {
      // The reducer already emits the final answer as an assistant message.
      if (item.toolName === "final_answer") return []
      const status = { running: "未完成", succeeded: "已完成", failed: "失败", declined: "已拒绝", interrupted: "已停止" }[item.status]
      return [{ id, role: "tool", label: `${item.toolName} · ${status}`, text: item.result ? toolPayloadText(item.result) : "无工具结果" }]
    }
    if (item.kind === "activity") return [{ id, role: item.activityType === "reasoning" ? "reasoning" : "tool", label: item.activityType === "reasoning" ? "思考过程" : "会话记录", text: item.text }]
    if (item.kind === "error") return [{ id, role: "tool", label: "历史错误", text: item.cause === "runtime" ? item.text : "历史操作失败。" }]
    // Structured file diffs are not rendered as raw protocol objects.
    return []
  }))
}
