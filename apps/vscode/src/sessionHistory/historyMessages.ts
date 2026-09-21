import { projectToolDetails } from "../chat/toolDetails.ts"
import type { ArtifactInput } from "../resources/artifacts.ts"
import { terminalReplyLast } from "../shared/timelineOrder.ts"
import { stoppedTurnMessage } from "../shared/turnStatus.ts"
import { toolPayloadText, type ConversationAttachment, type SessionHistoryPage } from "@codem/session-history"
import type { ArtifactView, AttachmentView, ActivityStatus, ChatMessage, TurnTiming } from "../shared/messages.ts"

/** Project durable history into display text. Raw records and host handles never cross this boundary. */
export function historyMessages(threadId: string, page: SessionHistoryPage, attachmentView?: (item: ConversationAttachment) => AttachmentView, artifactView?: (items: readonly ArtifactInput[]) => ArtifactView[], cwd = "/"): ChatMessage[] {
  return page.turns.flatMap(({ turn }) => [...terminalReplyLast(turn.items, [...turn.items].reverse().find(item => item.kind === "message" && item.role === "assistant" && item.delivery?.synthetic)?.id ?? null).flatMap((item): ChatMessage[] => {
    const id = `history:${threadId}:${turn.index}:${item.id}`
    if (item.kind === "message") {
      const text = item.role === "user" && item.attachments.length ? `${item.text}${item.text ? "\n" : ""}[${item.attachments.length} 个历史附件]` : item.text
      return [{ id, turnId: turn.id, role: item.role, label: item.role === "user" ? "你" : "CodeM", text: attachmentView ? item.text : text, ...(item.role === "assistant" && item.delivery?.structured && artifactView ? { artifacts: artifactView(item.delivery.structured.artifacts) } : {}), ...(item.role === "user" && attachmentView ? { attachments: item.attachments.map(attachmentView) } : {}) }]
    }
    if (item.kind === "tool-execution") {
      // The reducer already emits the final answer as an assistant message.
      if (item.toolName === "final_answer") return []
      const status: ActivityStatus = ({ running: "incomplete", succeeded: "completed", failed: "failed", declined: "declined", interrupted: "interrupted" } as const)[item.status]
      const details = projectToolDetails(item.toolName, item.input.value, cwd)
      return [{ id, turnId: turn.id, role: "tool", label: item.toolName, status, summary: "", text: item.result ? toolPayloadText(item.result) : "", ...(details ? { details } : {}) }]
    }
    if (item.kind === "activity") return [{ id, turnId: turn.id, role: item.activityType === "reasoning" ? "reasoning" : "tool", label: item.activityType === "reasoning" ? "思考过程" : "会话记录", status: "completed", summary: "", text: item.activityType === "reasoning" && item.redacted ? "Core 未提供可显示的内容。" : item.text }]
    if (item.kind === "error") return [{ id, turnId: turn.id, role: "tool", label: "历史错误", status: "failed", summary: "", text: item.cause === "runtime" ? item.text : "历史操作失败。" }]
    // Structured file diffs are not rendered as raw protocol objects.
    return []
  }), ...(turn.state === "stopped" ? [stoppedTurnMessage(turn.id)] : [])])
}

/** Unfinished durable records have no known elapsed duration; never restart them in the UI. */
export function historyTurnTimings(page: SessionHistoryPage): TurnTiming[] {
  return page.turns.flatMap(({ turn }) => turn.completedAt === null ? [] : [{
    turnId: turn.id, startedAt: Date.parse(turn.startedAt), finishedAt: Date.parse(turn.completedAt),
  }])
}

/** Read the current list from the entire durable session, never from visible tool arguments. */
export function historyPlan(page: SessionHistoryPage): { content: string; status: string }[] {
  return page.todoSnapshot?.items.map(item => ({ content: item.content, status: item.status })) ?? []
}
