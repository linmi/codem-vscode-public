import assert from "node:assert/strict"
import { it } from "node:test"
import { AccountController, type AccountIdentity, type AccountOperations } from "../src/connection/accountController.ts"

const authenticated: AccountIdentity = { avatar: { kind: "image", url: "https://s1-imfile.feishucdn.com/avatar.jpg" }, loggedIn: true, routerCredential: true, serverUrl: "https://private.invalid", userId: "user", tenantId: "tenant", displayName: "小林", authMethod: "browser" }
const signedOut = { ...authenticated, loggedIn: false, routerCredential: false }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }

it("account display initializes once, shares pending reads and projects only approved profile fields", async () => {
  const result = deferred<AccountIdentity>(); let reads = 0
  const account = new AccountController({ logout: async () => signedOut, read: () => { reads++; return result.promise }, login: async () => { throw Error("unexpected login") } }, () => {})
  const first = account.initialize(); const second = account.initialize()
  await Promise.resolve(); assert.equal(reads, 1)
  result.resolve(authenticated); await Promise.all([first, second]); await account.initialize(); await account.login()
  assert.equal(reads, 1)
  assert.deepEqual(account.snapshot(), { status: "signedIn", profile: { avatar: authenticated.avatar, displayName: "小林", userId: "user", tenantId: "tenant", authMethod: "browser" }, refreshing: false, notice: null })
  assert.doesNotMatch(JSON.stringify(account.snapshot()), /private|routerCredential|serverUrl/)
  await account.dispose()
})

it("account login is single flight; cancellation waits for cleanup and ignores late success before retry", async () => {
  const first = deferred<AccountIdentity>(); let logins = 0; let signal!: AbortSignal
  const account = new AccountController({ logout: async () => signedOut, read: async () => signedOut, login: async (s, progress) => { signal = s; logins++; progress("waiting"); return logins === 1 ? first.promise : authenticated } }, () => {})
  await account.initialize()
  const login = account.login(); await Promise.resolve(); const duplicate = account.login()
  assert.equal(logins, 1); assert.deepEqual(account.snapshot(), { status: "signingIn", progress: "waiting" })
  account.cancel(); assert.equal(signal.aborted, true)
  assert.deepEqual(account.snapshot(), { status: "signingIn", progress: "cancelling" })
  first.resolve(authenticated); await Promise.all([login, duplicate])
  assert.equal(account.snapshot().status, "signedOut")
  await account.login(); assert.equal(logins, 2); assert.equal(account.signedIn, true)
  await account.dispose()
})

it("read and login failures are sanitized and retryable; refreshing failure preserves an existing profile", async () => {
  let fail = true
  const operation = async () => { if (fail) throw Error("private token"); return authenticated }
  const account = new AccountController({ logout: async () => signedOut, read: operation, login: operation }, () => {})
  await account.initialize(); assert.equal(account.snapshot().status, "error")
  await account.login(); assert.doesNotMatch(JSON.stringify(account.snapshot()), /private|token/)
  fail = false; await account.login(); assert.equal(account.signedIn, true)
  fail = true; await account.refresh()
  const state = account.snapshot(); assert.equal(state.status, "signedIn")
  if (state.status === "signedIn") { assert.equal(state.refreshing, false); assert.match(state.notice!, /重试/); assert.equal(state.profile.userId, "user") }
  await account.dispose()
})

it("explicit auth invalidation and fresh runtime observations supersede stale account reads", async () => {
  const stale = deferred<AccountIdentity>()
  const account = new AccountController({ logout: async () => signedOut, read: () => stale.promise, login: async () => authenticated }, () => {})
  const read = account.initialize(); await Promise.resolve(); account.invalidate()
  stale.resolve(authenticated); await read; assert.equal(account.signedIn, false)
  account.observe(authenticated); assert.equal(account.signedIn, true)
  account.observe({ ...authenticated, routerCredential: false }); assert.equal(account.signedIn, false)
  account.observe({ ...authenticated, displayName: null, userId: null, tenantId: null, authMethod: null })
  assert.equal(account.signedIn, true)
  await account.dispose()
})

it("dispose aborts in-flight login, waits for cleanup and never publishes late state", async () => {
  const end = deferred<AccountIdentity>(); const states: unknown[] = []; let signal!: AbortSignal
  const operations: AccountOperations = { logout: async () => signedOut, read: async () => signedOut, login: async s => { signal = s; return end.promise } }
  const account = new AccountController(operations, state => states.push(state))
  const login = account.login(); await Promise.resolve(); const count = states.length
  let done = false; const disposal = account.dispose().then(() => { done = true })
  await Promise.resolve(); assert.equal(signal.aborted, true); assert.equal(done, false)
  end.resolve(authenticated); await Promise.all([login, disposal])
  assert.equal(states.length, count); await account.login(); assert.equal(states.length, count)
})

it("fresh runtime auth retains only the same account avatar and rejects a stale profile after identity changes", async () => {
  const pending = deferred<AccountIdentity>()
  const account = new AccountController({ logout: async () => signedOut, read: () => pending.promise, login: async () => authenticated }, () => {})
  await account.login(); account.observe(authenticated)
  const same = account.snapshot(); assert.equal(same.status === "signedIn" && same.profile.avatar.kind, "image")
  const refresh = account.refresh(); await Promise.resolve()
  account.observe({ ...authenticated, userId: "another" })
  pending.resolve(authenticated); await refresh
  const changed = account.snapshot()
  assert.equal(changed.status === "signedIn" && changed.profile.userId, "another")
  assert.deepEqual(changed.status === "signedIn" && changed.profile.avatar, { kind: "none" })
  account.invalidate(); assert.equal(account.snapshot().status, "signedOut")
  await account.dispose()
})

it("logout supersedes refresh, waits for connection cleanup, and ignores late auth observations", async () => {
  const stale = deferred<AccountIdentity>(), closed = deferred<void>(), loggedOut = deferred<typeof signedOut>()
  const calls: string[] = []
  const account = new AccountController({ read: () => stale.promise, login: async () => authenticated, logout: () => { calls.push("logout"); return loggedOut.promise } }, () => {})
  await account.login()
  const refresh = account.refresh(); await Promise.resolve()
  const logout = account.logout(() => { calls.push("disconnect"); return closed.promise })
  const duplicate = account.logout(async () => { assert.fail("duplicate cleanup") })
  assert.equal(account.signedIn, false)
  assert.equal(account.snapshot().status, "signingOut")
  account.observe(authenticated); account.invalidate()
  assert.equal(account.snapshot().status, "signingOut")
  stale.resolve(authenticated); await refresh
  await Promise.resolve(); assert.deepEqual(calls, ["disconnect"])
  closed.resolve(); await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, ["disconnect", "logout"])
  loggedOut.resolve(signedOut); await Promise.all([logout, duplicate])
  assert.deepEqual(account.snapshot(), { status: "signedOut", notice: "已退出登录。" })
  await account.initialize(); assert.deepEqual(calls, ["disconnect", "logout"], "Reload does not read auth or reconnect after explicit logout")
  await account.login(); assert.equal(account.signedIn, true)
  await account.dispose()
})
it("logout failure stays blocked and retries without exposing raw errors or a stale profile", async () => {
  let attempts = 0
  const account = new AccountController({ read: async () => authenticated, login: async () => authenticated, logout: async () => { if (++attempts === 1) throw Error("secret token"); if (attempts === 2) return authenticated; return signedOut } }, () => {})
  await account.initialize()
  await account.logout(async () => { throw Error("close failed") })
  assert.equal(attempts, 0)
  assert.equal(account.snapshot().status, "signOutFailed")
  await account.logout(async () => {})
  assert.equal(account.snapshot().status, "signOutFailed")
  assert.doesNotMatch(JSON.stringify(account.snapshot()), /secret|token|avatar|userId/)
  await account.refresh(); await account.login(); account.observe(authenticated)
  assert.equal(account.signedIn, false)
  await account.logout(async () => {})
  assert.equal(account.snapshot().status, "signOutFailed", "A command returning signed in cannot fake success")
  await account.logout(async () => {})
  assert.equal(account.snapshot().status, "signedOut")
  await account.dispose()
})
it("shutdown aborts logout and waits for its child cleanup without publishing late success", async () => {
  const result = deferred<typeof signedOut>(); let signal!: AbortSignal
  const states: unknown[] = []
  const account = new AccountController({ read: async () => authenticated, login: async () => authenticated, logout: s => { signal = s; return result.promise } }, value => states.push(value))
  await account.initialize()
  const logout = account.logout(async () => {})
  await new Promise(resolve => setImmediate(resolve))
  const count = states.length
  let finished = false
  const disposal = account.dispose().then(() => { finished = true })
  assert.equal(signal.aborted, true); assert.equal(finished, false)
  result.resolve(signedOut); await Promise.all([logout, disposal])
  assert.equal(states.length, count)
})
