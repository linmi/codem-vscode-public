import { terminalReplyLast } from "./timelineOrder.ts"
import { toolPayloadText, type ConversationAttachment, type SessionHistoryPage } from "@codem/session-history"
import type { AttachmentView, ActivityStatus, ChatMessage } from "./messages.ts"

/** Project durable history into display text. Raw records and host handles never cross this boundary. */
export function historyMessages(threadId: string, page: SessionHistoryPage, attachmentView?: (item: ConversationAttachment) => AttachmentView): ChatMessage[] {
  return page.turns.flatMap(({ turn }) => terminalReplyLast(turn.items, [...turn.items].reverse().find(item => item.kind === "message" && item.role === "assistant" && item.delivery?.synthetic)?.id ?? null).flatMap((item): ChatMessage[] => {
    const id = `history:${threadId}:${turn.index}:${item.id}`
    if (item.kind === "message") {
      const text = item.role === "user" && item.attachments.length ? `${item.text}${item.text ? "\n" : ""}[${item.attachments.length} 个历史附件]` : item.text
      return [{ id, role: item.role, label: item.role === "user" ? "你" : "CodeM", text: attachmentView ? item.text : text, ...(item.role === "user" && attachmentView ? { attachments: item.attachments.map(attachmentView) } : {}) }]
    }
    if (item.kind === "tool-execution") {
      // The reducer already emits the final answer as an assistant message.
      if (item.toolName === "final_answer") return []
      const status: ActivityStatus = ({ running: "incomplete", succeeded: "completed", failed: "failed", declined: "declined", interrupted: "interrupted" } as const)[item.status]
      return [{ id, role: "tool", label: item.toolName, status, summary: "", text: item.result ? toolPayloadText(item.result) : "" }]
    }
    if (item.kind === "activity") return [{ id, role: item.activityType === "reasoning" ? "reasoning" : "tool", label: item.activityType === "reasoning" ? "思考过程" : "会话记录", status: "completed", summary: "", text: item.activityType === "reasoning" && item.redacted ? "Core 未提供可显示的内容。" : item.text }]
    if (item.kind === "error") return [{ id, role: "tool", label: "历史错误", status: "failed", summary: "", text: item.cause === "runtime" ? item.text : "历史操作失败。" }]
    // Structured file diffs are not rendered as raw protocol objects.
    return []
  }))
}
