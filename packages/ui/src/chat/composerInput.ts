import type { ChatSnapshot, ComposerInputMode, SendKey } from "../contract.ts"

export interface InputModeText {
  /** 模式栏标题；普通对话不显示模式栏。 */
  label: string
  /** 模式栏说明，输入不可用时由不可用原因替代；普通对话不显示。 */
  hint: string
  placeholder: string
  /** 输入框的可访问名称。 */
  field: string
  /** 发送按钮的可访问名称。 */
  submit: string
}

const inputModeTexts: Readonly<Record<ComposerInputMode, InputModeText>> = {
  message: { label: "", hint: "", placeholder: "提出问题，或输入 / 选择会话操作…", field: "发送给 CodeM 的消息", submit: "发送消息" },
  steer: { label: "补充指令", hint: "补充当前任务的执行方向。", placeholder: "输入补充指令…", field: "会话命令输入", submit: "发送补充指令" },
  askSideQuestion: { label: "旁路提问", hint: "单独提问，回答显示在这里。", placeholder: "输入旁路提问…", field: "会话命令输入", submit: "发送补充指令" },
  shellCommand: { label: "Shell 命令", hint: "发送前会展示命令并请求确认。", placeholder: "输入要执行的命令…", field: "会话命令输入", submit: "检查命令" },
}

/** 输入栏各处按输入模式显示的文案都从这里取。 */
export function inputModeText(mode: ComposerInputMode): InputModeText {
  return inputModeTexts[mode]
}

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
