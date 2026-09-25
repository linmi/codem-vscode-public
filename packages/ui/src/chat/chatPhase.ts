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
}

/** ChatApp 按阶段派生的开关只在这里判断，组件里不再各写一遍阶段比较。 */
export function phaseFlags(phase: ChatPhase): PhaseFlags {
  return {
    busy: isBusy(phase),
    turnActive: phase === "sending" || phase === "running" || phase === "stopping",
    generating: phase === "running" || phase === "stopping",
    connected: phase !== "disconnected" && phase !== "connecting" && phase !== "failed" && phase !== "closing",
  }
}

/** 输入栏菜单与新建会话：阶段空闲，且没有后台进程或会话工具在处理。 */
export function sessionIdle(snapshot: Pick<ChatSnapshot, "phase" | "backgroundBusy" | "sessionTools">): boolean {
  return !isBusy(snapshot.phase) && !snapshot.backgroundBusy && !snapshot.sessionTools.busy
}
