import type { AppServerAuthStatus } from "@codem/app-server"
import type { AccountAvatar, AccountState } from "../shared/accountTypes.ts"
import { UserVisibleError } from "../shared/userVisibleError.ts"

export interface AccountIdentity extends AppServerAuthStatus { avatar: AccountAvatar }

export interface AccountOperations {
  logout: (signal: AbortSignal) => Promise<AppServerAuthStatus>
  read: (signal: AbortSignal) => Promise<AccountIdentity>
  login: (signal: AbortSignal, progress: (stage: "opening" | "waiting" | "binding") => void) => Promise<AccountIdentity>
}

/** Account display only. Every protected runtime operation still validates its own auth. */
export class AccountController {
  private avatarOwner: string | null = null
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
  /** Early admission for chat operations; each protected runtime operation still validates its own auth. */
  assertSignedIn(): void { if (!this.signedIn) throw new UserVisibleError("请先登录 CodeM。") }

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
  logout(endSession: () => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.state.status === "signingOut") return this.operation!.promise
    if (this.state.status !== "signedIn" && this.state.status !== "signOutFailed") return Promise.resolve()
    const previous = this.operation
    previous?.abort.abort()
    const operation = { abort: new AbortController(), promise: Promise.resolve() }
    this.operation = operation
    this.avatarOwner = null
    operation.promise = Promise.resolve().then(async () => {
      try {
        // Revoke session authority immediately, then await both cleanup and a retiring read.
        const results = await Promise.allSettled([endSession(), previous?.promise])
        if (results.some(result => result.status === "rejected")) {
          if (!operation.abort.signal.aborted && !this.disposed) this.set({ status: "signOutFailed", message: "连接清理未完成，请重载窗口后重试退出。" })
          return
        }
        operation.abort.signal.throwIfAborted()
        const status = await this.operations.logout(operation.abort.signal)
        if (status.loggedIn || status.routerCredential) throw new Error("Logout not confirmed")
        if (!operation.abort.signal.aborted && !this.disposed) this.set({ status: "signedOut", notice: "已退出登录。" })
      } catch {
        if (!operation.abort.signal.aborted && !this.disposed) this.set({ status: "signOutFailed", message: "退出登录未完成，连接已停用。请重试退出。" })
      } finally { if (this.operation === operation) this.operation = null }
    })
    this.set({ status: "signingOut" })
    return operation.promise
  }
  cancel(): void {
    if (this.state.status !== "signingIn") return
    this.operation?.abort.abort()
    this.set({ status: "signingIn", progress: "cancelling" })
  }
  observe(status: AppServerAuthStatus): void {
    if (this.disposed || this.state.status === "signingOut" || this.state.status === "signOutFailed") return
    this.operation?.abort.abort()
    const owner = accountKey(status)
    const avatar: AccountAvatar = owner && owner === this.avatarOwner && this.state.status === "signedIn" ? this.state.profile.avatar : { kind: "none" }
    this.apply({ ...status, avatar })
  }
  private apply(status: AccountIdentity): void {
    this.avatarOwner = accountKey(status)
    this.set(status.loggedIn && status.routerCredential === true
      ? { status: "signedIn", profile: { avatar: status.avatar, displayName: status.displayName, userId: status.userId, tenantId: status.tenantId, authMethod: status.authMethod }, refreshing: false, notice: null }
      : { status: "signedOut", notice: status.loggedIn ? "登录已失效，请重新登录。" : null })
  }
  invalidate(): void {
    if (this.state.status === "signingOut" || this.state.status === "signOutFailed") return
    this.avatarOwner = null
    this.operation?.abort.abort()
    this.set({ status: "signedOut", notice: "登录已失效，请重新登录。" })
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.operation?.abort.abort()
    await this.operation?.promise
  }

  private run(login: boolean): Promise<void> {
    if (this.disposed || this.state.status === "signOutFailed") return Promise.resolve()
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

function accountKey(status: AppServerAuthStatus): string | null {
  return status.loggedIn && status.routerCredential === true && status.serverUrl && status.tenantId && status.userId
    ? JSON.stringify([status.serverUrl, status.tenantId, status.userId]) : null
}
