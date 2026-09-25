import type { ChatPhase } from "../contract.ts"

export type WelcomeMotion = "idle" | "initializing" | "settled"

/**
 * 有消息或发送反馈时隐藏欢迎；connecting 播 Logo 动效；ready 后亮起标题。
 * 不读定时器，不在这里请求连接。
 */
export function welcomeState(
  phase: ChatPhase,
  hasMessages: boolean,
  hasWorkingStatus: boolean,
  previous: WelcomeMotion,
): { visible: boolean; motion: WelcomeMotion } {
  if (hasMessages) return { visible: false, motion: "idle" }
  if (phase === "connecting") return { visible: true, motion: "initializing" }
  if (hasWorkingStatus || phase === "loadingHistory" || phase === "sending" || phase === "running" || phase === "stopping") {
    return { visible: false, motion: "idle" }
  }
  return { visible: true, motion: phase === "ready" && previous !== "idle" ? "settled" : "idle" }
}
