import { isBusy, type ChatPhase, type ChatSnapshot } from "../contract.ts"

export interface PhaseFlags {
  /** 连接、恢复历史或回合进行中（isBusy）：收起菜单与斜杠，不接受文件提及。 */
  busy: boolean
  /** 已提交且未终止的回合：发送中、生成中、停止中。此时不接受粘贴图片。 */
  turnActive: boolean
  /** 生成中或停止中：显示停止按钮，除补充指令外隐藏发送按钮。 */
  generating: boolean
  /** 已建立连接：头部状态点点亮。 */
  connected: boolean
  /**
   * 输入 `/` 即展开斜杠菜单：空闲、运行中（/steer）和旁路提问中（状态行提示输入 /ask 查看或取消）。
   * 连接、恢复历史、发送和停止这些瞬态不展开；提交斜杠草稿仍可打开菜单查看各命令为何不可用。
   */
  slashMenu: boolean
}

/** ChatApp 按阶段派生的开关只在这里判断，组件里不再各写一遍阶段比较。 */
export function phaseFlags(phase: ChatPhase): PhaseFlags {
  return {
    busy: isBusy(phase),
    turnActive: phase === "sending" || phase === "running" || phase === "stopping",
    generating: phase === "running" || phase === "stopping",
    connected: phase !== "disconnected" && phase !== "connecting" && phase !== "failed" && phase !== "closing",
    slashMenu: !isBusy(phase) || phase === "running" || phase === "sideQuestion",
  }
}

/** 输入栏菜单与新建会话：阶段空闲，且没有后台进程或会话工具在处理。 */
export function sessionIdle(snapshot: Pick<ChatSnapshot, "phase" | "backgroundBusy" | "sessionTools">): boolean {
  return !isBusy(snapshot.phase) && !snapshot.backgroundBusy && !snapshot.sessionTools.busy
}

/**
 * 新建会话、切换会话：空闲时可以，运行中也可以（当前回合转到后台继续）。
 * 发送、停止、旁路提问、压缩或回退进行中，以及后台进程或会话工具在处理时不可切换。
 */
export function sessionSwitchable(snapshot: Pick<ChatSnapshot, "phase" | "backgroundBusy" | "sessionTools">): boolean {
  return (snapshot.phase === "ready" || snapshot.phase === "running") && !snapshot.backgroundBusy && !snapshot.sessionTools.busy
}
