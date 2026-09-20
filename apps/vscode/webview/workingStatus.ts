import type { ChatSnapshot } from "../src/messages.ts"
import type { PanelKind } from "../src/panelTypes.ts"

/** One continuous placeholder from submission through connection until response progress. */
export function workingStatus(state: Pick<ChatSnapshot, "phase" | "messages">, panel: PanelKind | null, pendingSubmission = false): { label: string; animate: boolean } | null {
  const processing = { label: "正在思考与处理…", animate: true }
  if (state.phase === "connecting" || (pendingSubmission && ["ready", "disconnected"].includes(state.phase))) return processing
  if (!["sending", "running", "stopping"].includes(state.phase)) return null
  if (state.phase === "stopping") return { label: "正在停止…", animate: true }
  if (panel === "approval") return { label: "等待你的批准…", animate: false }
  if (panel === "question") return { label: "等待你的回复…", animate: false }
  if (panel === "rewind") return { label: "等待选择回退范围…", animate: false }
  if (panel === "plan") return { label: "等待你确认计划…", animate: false }
  if (state.phase === "sending") return processing
  let lastUser = -1
  state.messages.forEach((message, index) => { if (message.role === "user") lastUser = index })
  const progress = state.messages.slice(lastUser + 1).some(message =>
    message.role === "tool" || message.text.trim().length > 0 || Boolean(message.artifacts?.length) ||
    (message.role === "reasoning" && message.summary.trim().length > 0))
  return progress ? null : processing
}
