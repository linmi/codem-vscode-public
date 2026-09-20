import type { ChatSnapshot } from "../src/messages.ts"
import type { PanelKind } from "../src/panelTypes.ts"

/** Footer is a placeholder until the current response supplies progress. */
export function workingStatus(state: Pick<ChatSnapshot, "phase" | "messages">, panel: PanelKind | null): { label: string; animate: boolean } | null {
  if (!["sending", "running", "stopping"].includes(state.phase)) return null
  if (state.phase === "stopping") return { label: "正在停止…", animate: true }
  if (panel === "approval") return { label: "等待你的批准…", animate: false }
  if (panel === "question") return { label: "等待你的回复…", animate: false }
  if (panel === "rewind") return { label: "等待选择回退范围…", animate: false }
  if (panel === "plan") return { label: "等待你确认计划…", animate: false }
  if (state.phase === "sending") return { label: "正在发送…", animate: true }
  let lastUser = -1
  state.messages.forEach((message, index) => { if (message.role === "user") lastUser = index })
  const progress = state.messages.slice(lastUser + 1).some(message =>
    message.role === "tool" || message.text.trim().length > 0 || Boolean(message.artifacts?.length) ||
    (message.role === "reasoning" && message.summary.trim().length > 0))
  return progress ? null : { label: "正在思考与处理…", animate: true }
}
