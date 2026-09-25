import type { ChatSnapshot, ComposerInputMode, FileHit, FileSearch, SendKey } from "../contract.ts"

export interface InputModeText {
  /** 模式栏标题；普通对话不显示模式栏。 */
  label: string
  /** 模式栏说明，输入不可用时由不可用原因替代；普通对话不显示。 */
  hint: string
  placeholder: string
  /** 输入框的可访问名称；能力输入写明是哪种输入，读屏切换模式后能听出来。 */
  field: string
  /**
   * 发送按钮的可访问名称，说明按下后投递的动作：补充指令走 steer，旁路提问走 askSideQuestion，
   * 两者是不同的 Core 请求，名称不能互相借用。
   */
  submit: string
}

const inputModeTexts: Readonly<Record<ComposerInputMode, InputModeText>> = {
  message: { label: "", hint: "", placeholder: "提出问题，或输入 / 选择会话操作…", field: "发送给 CodeM 的消息", submit: "发送消息" },
  steer: { label: "补充指令", hint: "补充当前任务的执行方向。", placeholder: "输入补充指令…", field: "补充指令输入", submit: "发送补充指令" },
  askSideQuestion: { label: "旁路提问", hint: "单独提问，回答显示在这里。", placeholder: "输入旁路提问…", field: "旁路提问输入", submit: "发送旁路提问" },
  shellCommand: { label: "Shell 命令", hint: "发送前会展示命令并请求确认。", placeholder: "输入要执行的命令…", field: "Shell 命令输入", submit: "检查命令" },
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
 * 一次 `@` 提及：最新发出的搜索请求，以及它的结果到达前继续显示的上一批结果。
 * 每敲一个字就换一次请求；只认最新请求会让菜单在两次结果之间收起再弹出。
 */
export interface MentionSession {
  request: string
  previous: string | null
}

/** 发出新请求时，上一个请求若已有结果（arrived），就由它接替成继续显示的那一批。 */
export function nextMentionSession(session: MentionSession | null, request: string, arrived: string | undefined): MentionSession {
  if (!session) return { request, previous: null }
  return { request, previous: arrived === session.request ? session.request : session.previous }
}

/**
 * 这次提及能显示的结果：Host 手里最新的一份必须是本次提及发出的最新请求或上一批，别的请求一律不认。
 * 没有文件、也不在搜索中且没有错误时不显示菜单，不留一个空框。
 */
export function mentionResults(search: FileSearch | null, session: MentionSession | null): FileSearch | null {
  if (!search || !session) return null
  if (search.requestId !== session.request && search.requestId !== session.previous) return null
  return search.status === "loading" || search.files.length > 0 || search.error ? search : null
}

/** 高亮项只对同一批结果有效；换了一批或该项已不在列表里，回到第一项。 */
export function activeMention(search: FileSearch | null, highlight: { requestId: string; id: string } | null): string | null {
  if (!search) return null
  if (highlight && highlight.requestId === search.requestId && search.files.some((file) => file.id === highlight.id)) return highlight.id
  return search.files[0]?.id ?? null
}

/** 方向键在结果里循环移动高亮。 */
export function stepMention(files: readonly FileHit[], active: string | null, step: 1 | -1): string | null {
  if (files.length === 0) return null
  const index = files.findIndex((file) => file.id === active)
  if (index < 0) return files[0]!.id
  return files[(index + step + files.length) % files.length]!.id
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
