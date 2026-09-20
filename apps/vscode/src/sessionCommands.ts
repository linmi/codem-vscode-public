import type { ChatSnapshot } from "./messages.ts"
export type SessionInputMode = "askSideQuestion" | "steer" | "shellCommand"
export type ComposerMode = "message" | SessionInputMode
export interface ToolsDraft { scope: string; text: string; mode: SessionInputMode }
export const sessionCommands = [
  { id: "files", label: "引用文件、图片或目录", group: "常用" },
  { id: "model", label: "选择模型", group: "常用" },
  { id: "mode", label: "切换 Agent / Plan", group: "常用" },
  { id: "history", label: "打开历史会话", group: "常用" },
  { id: "ask", label: "旁路提问", group: "输入" },
  { id: "steer", label: "补充运行中的指令", group: "输入" },
  { id: "shell", label: "执行 Shell 命令", group: "输入" },
  { id: "compact", label: "压缩当前上下文", group: "会话" },
  { id: "rewind", label: "选择回退检查点", group: "会话" },
  { id: "clear", label: "清空并开始新上下文", group: "会话" },
  { id: "rename", label: "重命名会话", group: "会话" },
  { id: "fork", label: "分叉会话", group: "会话" },
  { id: "archive", label: "归档会话", group: "会话" },
  { id: "unarchive", label: "解除归档", group: "会话" },
  { id: "delete", label: "删除会话记录", group: "会话" },
  { id: "skills", label: "选择技能", group: "能力" },
  { id: "catalog", label: "查看能力与运行目录", group: "能力" },
  { id: "directories", label: "管理额外工作目录", group: "能力" },
] as const
export type SessionCommandId = typeof sessionCommands[number]["id"]
export type SessionPanelCommand = Exclude<SessionCommandId, "files" | "model" | "mode" | "history" | "ask" | "steer" | "shell">
export const inputModes: Partial<Record<SessionCommandId, SessionInputMode>> = { ask: "askSideQuestion", steer: "steer", shell: "shellCommand" }
export function inputUnavailable(mode: ComposerMode, state: ChatSnapshot): string | null {
  if (state.sessionTools.busy || state.backgroundBusy) return "正在处理其他操作"
  if (mode !== "message" && !state.threadId) return "先发送消息建立会话"
  if (mode === "steer") return state.phase === "running" ? null : "主任务运行时可补充指令"
  return state.phase === "ready" || (mode === "message" && state.phase === "disconnected") ? null : "主任务空闲时可用"
}
export function commandUnavailable(id: SessionCommandId, state: ChatSnapshot): string | null {
  if (["skills", "catalog", "directories"].includes(id)) return null // Read existing state; refresh buttons enforce Host availability.
  if (id === "ask" && state.sessionTools.sideQuestion) return null // Also opens the existing answer / cancellation controls.
  if (state.phase === "disconnected" && !["files", "model", "mode", "history"].includes(id)) return "请先连接 CodeM"
  const reason = inputUnavailable(inputModes[id] ?? "message", state)
  if (reason) return reason
  if (["compact", "rewind", "clear", "rename", "fork", "archive", "delete"].includes(id) && !state.threadId) return "先发送消息建立会话"
  return null
}
export function slashQuery(text: string): string | null { return /^\/[a-z]*$/i.test(text) ? text.slice(1) : null }
