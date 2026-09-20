import type { AppServerAuthStatus, AppServerSpace, AppServerSpaceList } from "@codem/app-server"

/** Host-only, connection-scoped directory. Display cache never authorizes access. */
export class SpaceDirectory {
  private catalog: AppServerSpaceList
  private readonly account: string | null
  private readonly read: (signal: AbortSignal) => Promise<AppServerSpaceList>
  constructor(catalog: AppServerSpaceList, status: AppServerAuthStatus, read: (signal: AbortSignal) => Promise<AppServerSpaceList>) {
    this.catalog = catalog
    this.account = identity(status)
    this.read = read
  }
  list(): readonly AppServerSpace[] { return this.catalog.spaces }
  get accountKey(): string | null { return this.account }
  matchesAccount(status: AppServerAuthStatus): boolean { return this.account !== null && identity(status) === this.account }
  assertAccount(status: AppServerAuthStatus): void {
    if (this.account !== null && identity(status) !== this.account) throw new Error("CodeM account changed; reconnect before selecting a space")
  }
  async refresh(signal: AbortSignal): Promise<void> {
    const next = await this.read(signal)
    signal.throwIfAborted()
    this.catalog = next
  }
}
function identity(status: AppServerAuthStatus): string | null {
  if (!status.loggedIn) throw new Error("CodeM login is required")
  // Incomplete broker identity cannot establish that two selections share an account.
  if (!status.userId || !status.tenantId || !status.serverUrl) return null
  return JSON.stringify([status.serverUrl, status.tenantId, status.userId])
}
