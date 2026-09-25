export const APP_SERVER_ABANDONED_REQUEST_LIMIT = 32
export const APP_SERVER_ABANDONED_REQUEST_TTL_MS = 30_000

export class AbandonedRpcRequests {
  private readonly failProtocol: (error: Error) => void
  private readonly entries = new Map<string, number>()
  private sweepTimer: ReturnType<typeof setTimeout> | null = null

  constructor(failProtocol: (error: Error) => void) {
    this.failProtocol = failProtocol
  }

  get size(): number {
    return this.entries.size
  }

  add(key: string, method: string): void {
    if (this.entries.size >= APP_SERVER_ABANDONED_REQUEST_LIMIT) {
      this.failProtocol(
        new Error(
          `CodeM App Server exceeded ${APP_SERVER_ABANDONED_REQUEST_LIMIT} unacknowledged requests while abandoning ${method}`,
        ),
      )
      return
    }
    this.entries.set(key, Date.now() + APP_SERVER_ABANDONED_REQUEST_TTL_MS)
    this.scheduleSweep()
  }

  consume(key: string): boolean {
    if (!this.entries.delete(key)) return false
    this.scheduleSweep()
    return true
  }

  clear(): void {
    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer)
      this.sweepTimer = null
    }
    this.entries.clear()
  }

  private scheduleSweep(): void {
    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer)
      this.sweepTimer = null
    }
    let nextExpiry: number | null = null
    for (const expiresAt of this.entries.values()) {
      if (nextExpiry === null || expiresAt < nextExpiry) nextExpiry = expiresAt
    }
    if (nextExpiry === null) return
    this.sweepTimer = setTimeout(() => this.sweep(), Math.max(0, nextExpiry - Date.now()))
    this.sweepTimer.unref?.()
  }

  private sweep(): void {
    this.sweepTimer = null
    const now = Date.now()
    const expired = [...this.entries.entries()].find(([, expiresAt]) => expiresAt <= now)
    if (!expired) {
      this.scheduleSweep()
      return
    }
    this.failProtocol(
      new Error(
        `CodeM App Server did not acknowledge abandoned request ${expired[0]} within ${APP_SERVER_ABANDONED_REQUEST_TTL_MS}ms`,
      ),
    )
  }
}
