import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import {
  APP_SERVER_CLI_VERSION,
  APP_SERVER_CORE_VERSION,
  AppServerLoginCancelledError,
  assertAppServerAuthenticated,
  readAppServerAuthStatus,
  signOutAppServer,
  startAppServerLogin,
  type AppServerRuntime,
} from "../src/index.ts"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("App Server authentication", () => {
  it("aborts an in-flight status subprocess and rejects pre-aborted reads", async () => {
    const fixture = createAuthFixture({ status: "wait" })
    const abort = new AbortController()
    const pending = readAppServerAuthStatus({ ...fixture.options(), signal: abort.signal })
    abort.abort()
    await assert.rejects(pending, /cancelled/)
    await assert.rejects(readAppServerAuthStatus({ ...fixture.options(), signal: abort.signal }), { name: "AbortError" })
  })

  it("reads a strict signed-in credential-broker status", async () => {
    const fixture = createAuthFixture()
    const status = await readAppServerAuthStatus(fixture.options())

    assert.deepEqual(status, {
      loggedIn: true,
      authMethod: "oauth",
      routerCredential: true,
      serverUrl: "https://codem.example.com/",
      tenantId: "tenant-1",
      userId: "user-1",
      displayName: "CodeM User",
    })
    assert.doesNotThrow(() => assertAppServerAuthenticated(status))
  })

  it("accepts the CLI signed-out status with exit code one", async () => {
    const fixture = createAuthFixture({ status: "signed-out" })
    const status = await readAppServerAuthStatus(fixture.options())
    assert.equal(status.loggedIn, false)
    assert.throws(() => assertAppServerAuthenticated(status), /login is required/u)
  })

  it("rejects a signed-in status without a routable credential", async () => {
    const fixture = createAuthFixture({ status: "unroutable" })
    const status = await readAppServerAuthStatus(fixture.options())

    assert.equal(status.loggedIn, true)
    assert.equal(status.routerCredential, false)
    assert.throws(() => assertAppServerAuthenticated(status), /cannot route tasks/u)
  })

  it("rejects malformed successful status output", async () => {
    const fixture = createAuthFixture({ status: "malformed" })
    await assert.rejects(readAppServerAuthStatus(fixture.options()), /invalid JSON/u)
  })

  it("runs login and verifies the resulting routable status", async () => {
    const fixture = createAuthFixture({ status: "signed-out", login: "success" })
    const authorizationUrls: string[] = []
    const progress: string[] = []
    const operation = startAppServerLogin({
      ...fixture.options({ CODEM_FIXTURE_POST_LOGIN: "1" }),
      presentAuthorization: (url) => {
        authorizationUrls.push(url)
      },
      onProgress: (value) => progress.push(value),
    })

    const status = await operation.completed
    assert.equal(status.loggedIn, true)
    assert.equal(status.routerCredential, true)
    assert.deepEqual(authorizationUrls, ["https://passport.example.com/register-or-login"])
    assert.deepEqual(progress, ["authorization-ready", "binding", "authenticated"])
  })

  it("rejects a non-HTTPS authorization URL", async () => {
    const fixture = createAuthFixture({ login: "unsafe-url" })
    const operation = startAppServerLogin({
      ...fixture.options(),
      presentAuthorization: () => undefined,
    })
    await assert.rejects(operation.completed, /must be an HTTPS URL/u)
  })

  it("turns a synchronous authorization presentation failure into a controlled login failure", async () => {
    const fixture = createAuthFixture({ login: "wait" })
    const operation = startAppServerLogin({
      ...fixture.options(),
      closeTimeoutMs: 25,
      presentAuthorization: () => {
        throw new Error("presentation failed")
      },
    })

    await assert.rejects(operation.completed, /presentation failed/u)
  })

  it("cancels a login process that ignores SIGTERM", async () => {
    const fixture = createAuthFixture({ login: "wait" })
    let authorizationReady!: () => void
    const presented = new Promise<void>((resolve) => {
      authorizationReady = resolve
    })
    const operation = startAppServerLogin({
      ...fixture.options(),
      closeTimeoutMs: 25,
      presentAuthorization: () => authorizationReady(),
    })

    await presented
    await operation.cancel()
    await assert.rejects(operation.completed, AppServerLoginCancelledError)
  })

  it("cancels and reaps the final status verification after browser authorization succeeds", async () => {
    const fixture = createAuthFixture({ status: "wait", login: "success" })
    const marker = join(fixture.root, "status-started")
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const watcher = watch(fixture.root, (_event, file) => { if (file === "status-started") started() })
    const operation = startAppServerLogin({ ...fixture.options({ CODEM_FIXTURE_STATUS_MARKER: marker }), closeTimeoutMs: 25, presentAuthorization: () => {} })
    const rejected = assert.rejects(operation.completed, AppServerLoginCancelledError)
    try {
      await ready
      const pid = Number(readFileSync(marker, "utf8"))
      await operation.cancel(); await rejected
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
    } finally { watcher.close(); await operation.cancel() }
  })

  it("cancellation settles even when the authorization presenter is awaiting cancellation", { timeout: 2000 }, async () => {
    const fixture = createAuthFixture({ login: "success" })
    const operation = startAppServerLogin({
      ...fixture.options(),
      presentAuthorization: async () => {
        // Let the successful auth child exit while its presenter is still pending.
        await new Promise(resolve => setTimeout(resolve, 25))
        await operation.cancel()
      },
    })
    await assert.rejects(operation.completed, AppServerLoginCancelledError)
  })

  it("does not launch logout when its owner has already been cancelled", async () => {
    const fixture = createAuthFixture()
    const abort = new AbortController(); abort.abort()
    await assert.rejects(signOutAppServer({ ...fixture.options(), signal: abort.signal }))
    assert.equal((await readAppServerAuthStatus(fixture.options())).loggedIn, true)
  })

  it("cancels an in-flight logout child and waits for its exit", async () => {
    const fixture = createAuthFixture()
    const abort = new AbortController()
    const logout = signOutAppServer({ ...fixture.options({ CODEM_FIXTURE_LOGOUT: "wait" }), signal: abort.signal })
    const timer = setTimeout(() => abort.abort(), 30)
    try { await assert.rejects(logout, /cancelled/); assert.equal((await readAppServerAuthStatus(fixture.options())).loggedIn, true) }
    finally { clearTimeout(timer) }
  })

  it("signs out through the broker and verifies the signed-out state", async () => {
    const fixture = createAuthFixture()
    const status = await signOutAppServer(fixture.options())
    assert.equal(status.loggedIn, false)
  })
})

function createAuthFixture(options: { readonly status?: string; readonly login?: string } = {}) {
  const root = createTemporaryDirectory()
  const executablePath = join(root, "codem-auth")
  const statePath = join(root, "auth-state")
  writeFileSync(statePath, options.status ?? "signed-in")
  writeFileSync(executablePath, authFixtureSource())
  chmodSync(executablePath, 0o755)
  const runtime: AppServerRuntime = {
    target: "darwin-arm64",
    packageName: "fixture-core",
    coreVersion: APP_SERVER_CORE_VERSION,
    executablePath,
    licensePath: join(root, "LICENSE.core"),
    authPackageName: "fixture-auth",
    cliVersion: APP_SERVER_CLI_VERSION,
    authExecutablePath: executablePath,
    authLicensePath: join(root, "LICENSE.auth"),
  }
  return {
    root,
    options: (environment: NodeJS.ProcessEnv = {}) => ({
      runtime,
      workingDirectory: root,
      environment: {
        PATH: process.env.PATH,
        CODEM_FIXTURE_AUTH_STATE: statePath,
        CODEM_FIXTURE_LOGIN: options.login ?? "success",
        ...environment,
      },
      statusTimeoutMs: 5_000,
    }),
  }
}

function authFixtureSource(): string {
  return `#!/usr/bin/env node
const fs = require("node:fs")
const statePath = process.env.CODEM_FIXTURE_AUTH_STATE
const command = process.argv[2]
const action = process.argv[3]
if (command !== "auth") process.exit(9)
  if (action === "status") {
  const state = fs.readFileSync(statePath, "utf8")
  if (state === "wait") { if (process.env.CODEM_FIXTURE_STATUS_MARKER) { process.on("SIGTERM", () => {}); fs.writeFileSync(process.env.CODEM_FIXTURE_STATUS_MARKER, String(process.pid)) }; setInterval(() => {}, 1000); return }
  if (state === "malformed") {
    process.stdout.write("not-json\\n")
    process.exit(0)
  }
  if (state === "signed-out") {
    process.stdout.write(JSON.stringify({ loggedIn: false, authMethod: "none", routerCredential: null, serverUrl: "https://codem.example.com/" }) + "\\n")
    process.exit(1)
  }
  if (state === "unroutable") {
    process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "oauth", routerCredential: false, serverUrl: "https://codem.example.com/" }) + "\\n")
    process.exit(0)
  }
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "oauth", routerCredential: true, serverUrl: "https://codem.example.com/", tenantId: "tenant-1", userId: "user-1", displayName: "CodeM User" }) + "\\n")
  process.exit(0)
}
if (action === "logout") {
  if (process.env.CODEM_FIXTURE_LOGOUT === "wait") { setInterval(() => {}, 1000); return }
  fs.writeFileSync(statePath, "signed-out")
  process.exit(0)
}
if (action === "login") {
  const behavior = process.env.CODEM_FIXTURE_LOGIN
  const authorizationUrl = behavior === "unsafe-url" ? "http://attacker.example/login" : "https://passport.example.com/register-or-login"
  process.stdout.write(JSON.stringify({ type: "login_session", authorizationUrl }) + "\\n")
  if (behavior === "wait") {
    process.on("SIGTERM", () => undefined)
    setInterval(() => undefined, 1_000)
  } else if (behavior === "unsafe-url") {
    setInterval(() => undefined, 1_000)
  } else {
    process.stdout.write(JSON.stringify({ type: "login_binding" }) + "\\n")
    if (process.env.CODEM_FIXTURE_POST_LOGIN === "1") fs.writeFileSync(statePath, "signed-in")
    process.stdout.write(JSON.stringify({ type: "login_success" }) + "\\n")
    process.exit(0)
  }
}
`
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "codem-app-server-auth-"))
  temporaryDirectories.push(directory)
  return directory
}
