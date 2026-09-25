import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { PassThrough } from "node:stream"
import { afterEach, describe, it } from "node:test"
import {
  APP_SERVER_CORE_VERSION,
  AppServerRpcError,
  AppServerRpcPeer,
  REQUIRED_APP_SERVER_BOOLEAN_CAPABILITIES,
  REQUIRED_APP_SERVER_ITEM_STATUSES,
  REQUIRED_APP_SERVER_ITEM_TYPES,
  startAppServerConnection,
  type AppServerNotification,
} from "../src/index.ts"

const STARTUP_CLEANUP_FAILURE =
  "CodeM App Server startup cleanup failed: CodeM App Server did not exit after stdin close, SIGTERM, and SIGKILL"
const temporaryDirectories: string[] = []
const strayProcessIds: number[] = []

afterEach(() => {
  for (const pid of strayProcessIds.splice(0)) killIfAlive(pid)
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("AppServerRpcPeer", () => {
  it("writes JSON-RPC 2.0 requests, notifications, and responses", async () => {
    const fixture = createPeer()

    let written = onceLine(fixture.writes)
    fixture.peer.notify("initialized")
    assert.deepEqual(JSON.parse(await written), { jsonrpc: "2.0", method: "initialized", params: {} })

    written = onceLine(fixture.writes)
    fixture.peer.respond(41, { approved: true })
    assert.deepEqual(JSON.parse(await written), {
      jsonrpc: "2.0",
      id: 41,
      result: { approved: true },
    })

    fixture.stdout.end()
    await fixture.peer.close()
  })

  it("correlates responses and routes notifications", async () => {
    const notifications: AppServerNotification[] = []
    const fixture = createPeer({ notifications })
    const written = onceLine(fixture.writes)
    const response = fixture.peer.request("initialize", { clientInfo: { name: "test" } })
    const request = JSON.parse(await written) as { readonly id: number }

    fixture.stdout.write(`${JSON.stringify({ method: "thread/started", params: { threadId: "thread-1" } })}\n`)
    fixture.stdout.write(`${JSON.stringify({ id: request.id, result: { protocolVersion: 1 } })}\n`)

    assert.deepEqual(await response, { protocolVersion: 1 })
    assert.equal(fixture.peer.responseJsonrpc, "omitted")
    await waitFor(() => notifications.length === 1)
    assert.equal(notifications[0]?.method, "thread/started")
    fixture.stdout.end()
    await fixture.peer.close()
  })

  it("surfaces structured RPC errors", async () => {
    const fixture = createPeer()
    const written = onceLine(fixture.writes)
    const response = fixture.peer.request("turn/start")
    const request = JSON.parse(await written) as { readonly id: number }
    fixture.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Invalid params", data: "bad thread" } })}\n`,
    )

    await assert.rejects(response, { code: -32602, data: "bad thread" })
    assert.equal(fixture.peer.responseJsonrpc, "2.0")
    fixture.stdout.end()
    await fixture.peer.close()
  })

  it("ignores one late response to an explicitly abandoned request", async () => {
    const fixture = createPeer()
    const written = onceLine(fixture.writes)
    const abandoned = fixture.peer.requestAbandonable("thread/sideQuestion/cancel")
    const request = JSON.parse(await written) as { readonly id: number }
    abandoned.abandon()
    fixture.stdout.write(`${JSON.stringify({ id: request.id, result: { status: "cancelled" } })}\n`)
    await waitFor(() => fixture.peer.abandonedRequestCount === 0)
    assert.deepEqual(fixture.protocolErrors, [])
    fixture.stdout.end()
    await fixture.peer.close()
  })

  it("fails closed on a duplicate or otherwise unknown response", async () => {
    const fixture = createPeer()
    fixture.stdout.write(`${JSON.stringify({ id: 999, result: {} })}\n`)
    await waitFor(() => fixture.protocolErrors.length === 1)
    assert.match(fixture.protocolErrors[0]!.message, /unknown request 999/u)
    assert.throws(() => fixture.peer.notify("initialized"), /stdin is not writable/u)
    fixture.stdout.end()
    await fixture.peer.close()
  })

  it("fails closed when a correlated response has neither a valid result nor error", async () => {
    const fixture = createPeer()
    const written = onceLine(fixture.writes)
    const response = fixture.peer.request("thread/list")
    const request = JSON.parse(await written) as { readonly id: number }
    fixture.stdout.write(`${JSON.stringify({ id: request.id, error: { message: "bad" } })}\n`)

    await assert.rejects(response, /invalid error/u)
    await waitFor(() => fixture.protocolErrors.length === 1)
    assert.throws(() => fixture.peer.notify("initialized"), /stdin is not writable/u)
    fixture.stdout.end()
    await fixture.peer.close()
  })
})

describe("AppServerConnection", () => {
  it("owns a long-lived initialized process and closes it intentionally", async () => {
    const root = createTemporaryDirectory()
    const executablePath = join(root, "fake-codem-core")
    writeFileSync(executablePath, fakeCoreSource())
    const notifications: AppServerNotification[] = []
    const stderr: string[] = []
    const exits: Array<{ readonly expected: boolean }> = []
    const connection = await startAppServerConnection({
      runtime: {
        target: "darwin-arm64",
        packageName: "fixture",
        coreVersion: APP_SERVER_CORE_VERSION,
        executablePath: process.execPath,
        licensePath: join(root, "LICENSE"),
        authPackageName: "fixture-auth",
        cliVersion: "0.1.208",
        authExecutablePath: executablePath,
        authLicensePath: join(root, "LICENSE.auth"),
      },
      arguments: [executablePath],
      workingDirectory: root,
      clientInfo: { name: "codem-vscode", version: "0.1.0" },
      environment: { PATH: process.env.PATH },
      onNotification: (notification) => notifications.push(notification),
      onStderr: (text) => stderr.push(text),
      onExit: (exit) => exits.push(exit),
    })

    assert.equal(connection.initialization.protocolVersion, 1)
    assert.equal(connection.responseJsonrpc, "omitted")
    assert.deepEqual(await connection.request("environment/info"), { alive: true })
    await waitFor(() => notifications.some((entry) => entry.method === "thread/started"))
    await waitFor(() => stderr.join("").includes("fixture ready"))
    await connection.close()
    assert.equal(exits.length, 1)
    assert.equal(exits[0]?.expected, true)
  })

  it("escalates shutdown when Core ignores stdin close and SIGTERM", async () => {
    const root = createTemporaryDirectory()
    const executablePath = join(root, "stuck-codem-core")
    writeFileSync(executablePath, stuckCoreSource())
    const exits: Array<{ readonly expected: boolean }> = []
    const connection = await startAppServerConnection({
      runtime: {
        target: "darwin-arm64",
        packageName: "fixture",
        coreVersion: APP_SERVER_CORE_VERSION,
        executablePath: process.execPath,
        licensePath: join(root, "LICENSE"),
        authPackageName: "fixture-auth",
        cliVersion: "0.1.208",
        authExecutablePath: executablePath,
        authLicensePath: join(root, "LICENSE.auth"),
      },
      arguments: [executablePath],
      workingDirectory: root,
      clientInfo: { name: "codem-vscode", version: "0.1.0" },
      environment: { PATH: process.env.PATH },
      // close() must succeed, so a step has to outlast a real kill. Windows sends TerminateProcess at the
      // SIGTERM step, and windows-latest has needed more than two 25 ms steps to report the close.
      closeTimeoutMs: 500,
      onExit: (exit) => exits.push(exit),
    })

    await connection.close()
    assert.equal(exits.length, 1)
    assert.equal(exits[0]?.expected, true)
  })

  it("bounds process cleanup when initialize times out", async () => {
    const root = createTemporaryDirectory()
    const executablePath = join(root, "silent-codem-core")
    writeFileSync(
      executablePath,
      `#!/usr/bin/env node
setInterval(() => undefined, 1_000)
process.on("SIGTERM", () => undefined)
process.stdin.resume()
`,
    )
    const exits: Array<{ readonly expected: boolean }> = []
    const protocolErrors: Error[] = []

    await assert.rejects(
      startAppServerConnection({
        runtime: {
          target: "darwin-arm64",
          packageName: "fixture",
          coreVersion: APP_SERVER_CORE_VERSION,
          executablePath: process.execPath,
          licensePath: join(root, "LICENSE"),
          authPackageName: "fixture-auth",
          cliVersion: "0.1.208",
          authExecutablePath: executablePath,
          authLicensePath: join(root, "LICENSE.auth"),
        },
        arguments: [executablePath],
        workingDirectory: root,
        clientInfo: { name: "codem-vscode", version: "0.1.0" },
        environment: { PATH: process.env.PATH },
        initializeTimeoutMs: 25,
        closeTimeoutMs: 25,
        onProtocolError: (error) => protocolErrors.push(error),
        onExit: (exit) => exits.push(exit),
      }),
      /initialize timed out/u,
    )
    // The initialize timeout is the rejection either way. A loaded runner (seen on windows-latest) can
    // need more than the 25 ms steps to observe the killed child close; that is reported, not thrown.
    if (protocolErrors.length === 0) {
      assert.equal(exits.length, 1, "a child reaped inside the budget has reported its exit before the rejection")
    } else {
      assert.deepEqual(protocolErrors.map((error) => error.message), [STARTUP_CLEANUP_FAILURE])
      await waitFor(() => exits.length === 1, 10_000)
    }
    assert.equal(exits[0]?.expected, true)
  })

  it("keeps the startup failure when Core outlives its cleanup, and reports the cleanup failure", async () => {
    const root = createTemporaryDirectory()
    const executablePath = join(root, "pipe-holding-codem-core")
    writeFileSync(executablePath, pipeHoldingCoreSource())
    const exits: Array<{ readonly expected: boolean }> = []
    const protocolErrors: Error[] = []
    let stderr = ""
    let holderPid = 0

    await assert.rejects(
      startAppServerConnection({
        runtime: {
          target: "darwin-arm64",
          packageName: "fixture",
          coreVersion: APP_SERVER_CORE_VERSION,
          executablePath: process.execPath,
          licensePath: join(root, "LICENSE"),
          authPackageName: "fixture-auth",
          cliVersion: "0.1.208",
          authExecutablePath: executablePath,
          authLicensePath: join(root, "LICENSE.auth"),
        },
        arguments: [executablePath],
        workingDirectory: root,
        clientInfo: { name: "codem-vscode", version: "0.1.0" },
        environment: { PATH: process.env.PATH },
        // Core answers as soon as the holder is up; this only bounds a broken fixture.
        initializeTimeoutMs: 30_000,
        closeTimeoutMs: 25,
        onProtocolError: (error) => protocolErrors.push(error),
        onStderr: (text) => {
          stderr += text
          const reported = /holder (\d+)\n/u.exec(stderr)
          if (!reported || holderPid) return
          holderPid = Number(reported[1])
          strayProcessIds.push(holderPid)
        },
        onExit: (exit) => exits.push(exit),
      }),
      (error: unknown) => error instanceof AppServerRpcError && error.code === -32001,
    )
    // The holder keeps Core's stdout and stderr open, so no budget can observe the close.
    assert.equal(exits.length, 0, "startup must return on its cleanup budget, not wait for the close")
    assert.equal(protocolErrors.length, 1)
    assert.equal(protocolErrors[0]?.message, STARTUP_CLEANUP_FAILURE)
    assert.match(String((protocolErrors[0]?.cause as Error | undefined)?.message), /^CodeM App Server did not exit/u)

    await waitFor(() => holderPid > 0)
    killIfAlive(holderPid)
    await waitFor(() => exits.length === 1, 10_000)
    assert.equal(exits[0]?.expected, true)
  })
})

function createPeer(options: { readonly notifications?: AppServerNotification[] } = {}) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const writes = createInterface({ input: stdin })
  const protocolErrors: Error[] = []
  const peer = new AppServerRpcPeer({
    stdin,
    stdoutLines: createInterface({ input: stdout }),
    onNotification: (notification) => options.notifications?.push(notification),
    onRequest: () => undefined,
    onProtocolError: (error) => protocolErrors.push(error),
  })
  return { peer, stdout, writes, protocolErrors }
}

function fakeCoreSource(): string {
  const capabilities = completeCapabilities()
  return `#!/usr/bin/env node
if (process.argv.slice(2).join(" ") !== "app-server") {
  process.stderr.write("unexpected arguments: " + process.argv.slice(2).join(" ") + "\\n")
  process.exit(2)
}
const readline = require("node:readline")
const input = readline.createInterface({ input: process.stdin })
input.on("line", (line) => {
  const frame = JSON.parse(line)
  if (frame.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: frame.id, result: {
      protocolVersion: 1,
      agentInfo: { version: "${APP_SERVER_CORE_VERSION}+1.g0123456" },
      capabilities: ${JSON.stringify(capabilities)}
    } }) + "\\n")
    return
  }
  if (frame.method === "initialized") {
    process.stderr.write("fixture ready\\n")
    process.stdout.write(JSON.stringify({ method: "thread/started", params: { threadId: "thread-1" } }) + "\\n")
    return
  }
  if (frame.method === "environment/info") {
    process.stdout.write(JSON.stringify({ id: frame.id, result: { alive: true } }) + "\\n")
  }
})
`
}

function stuckCoreSource(): string {
  const capabilities = completeCapabilities()
  return `#!/usr/bin/env node
const readline = require("node:readline")
setInterval(() => undefined, 1_000)
process.on("SIGTERM", () => undefined)
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line)
  if (frame.method !== "initialize") return
  process.stdout.write(JSON.stringify({ id: frame.id, result: {
    protocolVersion: 1,
    agentInfo: { version: "${APP_SERVER_CORE_VERSION}+1.g0123456" },
    capabilities: ${JSON.stringify(capabilities)}
  } }) + "\\n")
})
`
}

/** Refuses initialize once a holder process shares its stdout and stderr, so its close outlasts any kill. */
function pipeHoldingCoreSource(): string {
  return `#!/usr/bin/env node
const { spawn } = require("node:child_process")
const readline = require("node:readline")
setInterval(() => undefined, 1_000)
process.on("SIGTERM", () => undefined)
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line)
  if (frame.method !== "initialize") return
  const holder = spawn(process.execPath, ["-e", "setTimeout(() => undefined, 30_000)"], {
    cwd: require("node:os").tmpdir(),
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  })
  holder.once("spawn", () => {
    process.stderr.write("holder " + holder.pid + "\\n")
    process.stdout.write(JSON.stringify({ id: frame.id, error: { code: -32001, message: "fixture refuses initialize" } }) + "\\n")
  })
})
`
}

function completeCapabilities(): Record<string, unknown> {
  const capabilities: Record<string, unknown> = {}
  for (const path of REQUIRED_APP_SERVER_BOOLEAN_CAPABILITIES) assignNested(capabilities, path, true)
  assignNested(capabilities, "items.types", [...REQUIRED_APP_SERVER_ITEM_TYPES])
  assignNested(capabilities, "items.statuses", [...REQUIRED_APP_SERVER_ITEM_STATUSES])
  return capabilities
}

function assignNested(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".")
  let current = target
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment]
    if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
      current = existing as Record<string, unknown>
    } else {
      const next: Record<string, unknown> = {}
      current[segment] = next
      current = next
    }
  }
  current[segments.at(-1)!] = value
}

function onceLine(interface_: ReturnType<typeof createInterface>): Promise<string> {
  return new Promise((resolve) => interface_.once("line", resolve))
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for test condition")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function killIfAlive(pid: number): void {
  // A missing pid must never become a signal to the test's own process group.
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    process.kill(pid, "SIGKILL")
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "codem connection 中文 -"))
  temporaryDirectories.push(directory)
  return directory
}
