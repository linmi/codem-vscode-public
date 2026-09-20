import type { AppServerAuthStatus } from "@codem/app-server"
import type { AccountState } from "../shared/accountTypes.ts"

export interface AccountOperations {
  read: (signal: AbortSignal) => Promise<AppServerAuthStatus>
  login: (signal: AbortSignal, progress: (stage: "opening" | "waiting" | "binding") => void) => Promise<AppServerAuthStatus>
}

/** Account display only. Every protected runtime operation still validates its own auth. */
export class AccountController {
  private state: AccountState = { status: "checking" }
  private operation: { abort: AbortController; promise: Promise<void> } | null = null
  private disposed = false
  private readonly operations: AccountOperations
  private readonly changed: (state: AccountState) => void

  constructor(operations: AccountOperations, changed: (state: AccountState) => void) {
    this.operations = operations
    this.changed = changed
  }
  snapshot(): AccountState { return structuredClone(this.state) }
  publish(): void { if (!this.disposed) this.changed(this.snapshot()) }
  get signedIn(): boolean { return this.state.status === "signedIn" }

  initialize(): Promise<void> {
    if (this.operation) return this.operation.promise
    return this.state.status === "checking" ? this.refresh() : Promise.resolve()
  }
  refresh(): Promise<void> {
    return this.run(false)
  }
  login(): Promise<void> {
    if (this.signedIn) return Promise.resolve()
    return this.run(true)
  }
  cancel(): void {
    if (this.state.status !== "signingIn") return
    this.operation?.abort.abort()
    this.set({ status: "signingIn", progress: "cancelling" })
  }
  observe(status: AppServerAuthStatus): void {
    if (this.disposed) return
    this.operation?.abort.abort()
    this.apply(status)
  }
  private apply(status: AppServerAuthStatus): void {
    this.set(status.loggedIn && status.routerCredential === true
      ? { status: "signedIn", profile: { displayName: status.displayName, userId: status.userId, tenantId: status.tenantId, authMethod: status.authMethod }, refreshing: false, notice: null }
      : { status: "signedOut", notice: status.loggedIn ? "登录已失效，请重新登录。" : null })
  }
  invalidate(): void {
    this.operation?.abort.abort()
    this.set({ status: "signedOut", notice: "登录已失效，请重新登录。" })
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.operation?.abort.abort()
    await this.operation?.promise
  }

  private run(login: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.operation) return this.operation.promise
    const operation = { abort: new AbortController(), promise: Promise.resolve() }
    this.operation = operation
    // Install the operation before invoking async dependencies or publishing progress.
    operation.promise = Promise.resolve().then(async () => {
      try {
        operation.abort.signal.throwIfAborted()
        const status = login
          ? await this.operations.login(operation.abort.signal, progress => {
            if (!operation.abort.signal.aborted && !this.disposed && this.operation === operation) this.set({ status: "signingIn", progress })
          })
          : await this.operations.read(operation.abort.signal)
        if (!operation.abort.signal.aborted && !this.disposed && this.operation === operation) this.apply(status)
      } catch {
        if (!operation.abort.signal.aborted && !this.disposed && this.operation === operation) {
          if (this.state.status === "signedIn") this.set({ ...this.state, refreshing: false, notice: "暂时无法刷新账户信息，请重试。" })
          else this.set({ status: "error", message: login ? "登录未完成，请重试。" : "暂时无法读取登录状态，请重试。" })
        }
      } finally {
        if (this.operation === operation) {
          this.operation = null
          if (operation.abort.signal.aborted && this.state.status === "signingIn") this.set({ status: "signedOut", notice: "已取消登录，可随时重试。" })
        }
      }
    })
    if (login) this.set({ status: "signingIn", progress: "opening" })
    else if (this.state.status === "signedIn") this.set({ ...this.state, refreshing: true, notice: null })
    else this.set({ status: "checking" })
    return operation.promise
  }
  private set(state: AccountState): void {
    if (this.disposed) return
    this.state = state
    this.publish()
  }
}
