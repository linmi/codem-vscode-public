import type { SendResult } from "../src/messages.ts"

/** Only the matching Host receipt can consume the submitted draft revision. */
export class ComposerSubmission {
  private revision = 0
  private pending: { requestId: string; revision: number } | null = null
  get busy(): boolean { return this.pending !== null }
  reset(): void { this.pending = null; this.revision++ }
  edited(): void { this.revision++ }
  begin(requestId: string): boolean {
    if (this.pending) return false
    this.pending = { requestId, revision: this.revision }
    return true
  }
  settle(result: SendResult): boolean {
    if (result.requestId !== this.pending?.requestId) return false
    const clear = result.accepted && this.revision === this.pending.revision
    this.pending = null
    return clear
  }
}
