import type { ChatSnapshot, SendKey } from "../contract.ts"

/** 光标前的 `@query`。查询本身不超过 200，并且不能跨行。 */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const head = text.slice(0, caret)
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(head)
  if (!match || match[1]!.length > 200) return null
  return { query: match[1]!, start: caret - match[1]!.length - 1 }
}

/**
 * Enter 发送，Shift+Enter 换行。
 * modEnter 时要按住 Ctrl 或 Command 才发送，单独的 Enter 留在输入框里。
 */
export function sendOnEnter(sendKey: SendKey, shift: boolean, modified: boolean, composing: boolean): boolean {
  if (shift || composing) return false
  return sendKey === "modEnter" ? modified : !modified
}

/**
 * 普通输入在当前阶段交给谁。
 * 轮次生成中，新文字是补充指令，不要求先停下后台进程。
 * 轮次空闲时才是一条新消息。发送中和停止中先不投递。
 */
export function composerMessageAction(phase: ChatSnapshot["phase"]): "send" | "steer" | "none" {
  if (phase === "running") return "steer"
  if (phase === "ready" || phase === "disconnected") return "send"
  return "none"
}
