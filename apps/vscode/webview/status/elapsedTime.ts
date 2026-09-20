import type { TurnTiming } from "../../src/shared/messages.ts"

export function elapsedTime(timing: TurnTiming, now: number): string {
  const seconds = Math.max(0, Math.floor(((timing.finishedAt ?? now) - timing.startedAt) / 1000))
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60)
  return `${hours ? `${hours}小时 ` : ""}${minutes || hours ? `${minutes}分 ` : ""}${seconds % 60}秒`
}
