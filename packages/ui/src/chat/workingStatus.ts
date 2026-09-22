import type { ChatSnapshot } from "../contract.ts"

/**
 * 与 VS Code webview/status/workingStatus.ts 相同：
 * 从提交到出现思考、工具或正文之前，底部只有一条加载。
 * 审批、问答、计划和回退各自有一句等待，不另造文案。
 */
export function workingStatus(
  snapshot: Pick<ChatSnapshot, "phase" | "messages" | "pendingPanel">,
): { label: string; animate: boolean } | null {
  const processing = { label: "正在思考与处理…", animate: true }
  if (snapshot.phase === "connecting") return processing
  if (snapshot.phase !== "sending" && snapshot.phase !== "running" && snapshot.phase !== "stopping") return null
  if (snapshot.phase === "stopping") return { label: "正在停止…", animate: true }
  const panel = snapshot.pendingPanel?.kind
  if (panel === "approval") return { label: "等待你的批准…", animate: false }
  if (panel === "question") return { label: "等待你的回复…", animate: false }
  if (panel === "rewind") return { label: "等待选择回退范围…", animate: false }
  if (panel === "plan") return { label: "等待你确认计划…", animate: false }
  if (snapshot.phase === "sending") return processing
  let lastUser = -1
  snapshot.messages.forEach((message, index) => {
    if (message.role === "user") lastUser = index
  })
  const progress = snapshot.messages.slice(lastUser + 1).some((message) =>
    message.role === "tool" ||
    message.text.trim().length > 0 ||
    Boolean(message.artifacts?.length) ||
    message.hasArtifacts === true ||
    (message.role === "reasoning" && Boolean(message.summary?.trim())),
  )
  return progress ? null : processing
}
