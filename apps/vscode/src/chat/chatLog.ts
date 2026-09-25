import type { ChatPhase } from "../shared/messages.ts"
import { UserVisibleError } from "../shared/userVisibleError.ts"

/**
 * The chat's lines in the CodeM output channel: phase timings and failed operations. Raw Core frames,
 * broker output, tokens and arbitrary exception payloads are never written.
 */
export class ChatLog {
  private previousPhase: ChatPhase | null = null
  private connectingAt: number | null = null
  private readonly write: (line: string) => void
  constructor(write: (line: string) => void) { this.write = write }

  /** Logs each phase change once, and how long a connection attempt took to settle. */
  phase(phase: ChatPhase): void {
    if (phase === this.previousPhase) return
    if (phase === "connecting") this.connectingAt = performance.now()
    else if (this.connectingAt !== null) {
      this.write(`Connection ${phase}: ${Math.round(performance.now() - this.connectingAt)}ms`)
      this.connectingAt = null
    }
    this.write(`UI phase: ${phase}`); this.previousPhase = phase
  }

  report(operation: string, error: unknown): void {
    this.write(`${new Date().toISOString()} ${operation}: ${error instanceof UserVisibleError ? error.message : "操作失败；请检查运行时文件、CodeM 登录和网络连接。"}`)
  }
}
