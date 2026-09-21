import type { TurnStatusMessage } from "./messages.ts"

/** A stop belongs to its Core turn, never to the next prompt or a global warning. */
export function stoppedTurnMessage(turnId: string): TurnStatusMessage {
  return { id: `turnStatus:${turnId}`, turnId, role: "turnStatus", outcome: "stopped", label: "本轮状态", text: "已停止生成。" }
}
