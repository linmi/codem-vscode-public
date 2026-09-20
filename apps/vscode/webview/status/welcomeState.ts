import type { ChatPhase } from "../../src/shared/messages.ts"

export type WelcomeMotion = "idle" | "initializing" | "settled"

export function welcomeState(phase: ChatPhase, hasMessages: boolean, hasWorkingStatus: boolean, previous: WelcomeMotion): { visible: boolean; motion: WelcomeMotion } {
  if (hasMessages) return { visible: false, motion: "idle" }
  if (phase === "connecting") return { visible: true, motion: "initializing" }
  if (hasWorkingStatus || ["loadingHistory", "sending", "running", "stopping"].includes(phase)) return { visible: false, motion: "idle" }
  return { visible: true, motion: phase === "ready" && previous !== "idle" ? "settled" : "idle" }
}
