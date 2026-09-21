import type { ChatSnapshot, ComposerInputMode, SlashCommand } from "../contract.ts"

/** 方案规定的固定会话命令。打开菜单只过滤这份目录，不请求 Host 或 Core。 */
export const builtinSlashCommands: readonly SlashCommand[] = [
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
]

export const slashGroups = ["常用", "输入", "会话"] as const

export const inputModes: Partial<Record<string, ComposerInputMode>> = {
  ask: "askSideQuestion",
  steer: "steer",
  shell: "shellCommand",
}

export function slashCatalog(snapshot: Pick<ChatSnapshot, "slashCommands">): readonly SlashCommand[] {
  return snapshot.slashCommands.length ? snapshot.slashCommands : builtinSlashCommands
}

export function slashQuery(text: string): string | null {
  return /^\/[a-z]*$/iu.test(text) ? text.slice(1) : null
}

export function inputUnavailable(mode: ComposerInputMode, snapshot: Pick<ChatSnapshot, "phase" | "threadId" | "sessionTools">): string | null {
  if (snapshot.sessionTools.busy) return "正在处理其他操作"
  if (mode !== "message" && !snapshot.threadId) return "先发送消息建立会话"
  if (mode === "steer") return snapshot.phase === "running" ? null : "主任务运行时可补充指令"
  return snapshot.phase === "ready" || (mode === "message" && snapshot.phase === "disconnected") ? null : "主任务空闲时可用"
}

export function commandUnavailable(id: string, snapshot: Pick<ChatSnapshot, "phase" | "threadId" | "sessionTools">): string | null {
  if (["skills", "catalog", "directories"].includes(id)) return null
  if (snapshot.phase === "disconnected" && !["files", "model", "mode", "history"].includes(id)) return "请先连接 CodeM"
  const reason = inputUnavailable(inputModes[id] ?? "message", snapshot)
  if (reason) return reason
  if (["compact", "rewind", "clear", "rename", "fork", "archive", "delete"].includes(id) && !snapshot.threadId) return "先发送消息建立会话"
  return null
}
