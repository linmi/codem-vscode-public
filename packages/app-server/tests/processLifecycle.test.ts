import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { afterEach, describe, it } from "node:test"
import {
  AUTH_COMMAND_TERMINATION,
  AUTH_LOGIN_TERMINATION,
  CORE_APP_SERVER_TERMINATION,
  PLUGIN_COMMAND_TERMINATION,
  SPACE_BROKER_TERMINATION,
  requirePositiveTimeout,
  terminateChildProcess,
  terminationSpawnOptions,
  type GracefulTermination,
  type ProcessControl,
} from "../src/processLifecycle.ts"

const STEP_MS = 20
const graceful = (overrides: Partial<GracefulTermination> = {}): GracefulTermination => ({
  escalation: "graceful",
  processName: "Fixture process",
  tree: false,
  exitsOnStdinClose: false,
  stepTimeoutMs: STEP_MS,
  ...overrides,
})

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe("child process termination policy", () => {
  it("keeps Core inside the shutdown budget and signals a process tree only for plugin commands", () => {
    // docs/qualityGates.md: the Host releases for at most 1 s, then EOF, SIGTERM and SIGKILL steps; 7 s in total.
    assert.equal(CORE_APP_SERVER_TERMINATION.exitsOnStdinClose, true)
    assert.ok(1_000 + 3 * CORE_APP_SERVER_TERMINATION.stepTimeoutMs <= 7_000)
    const policies = {
      core: CORE_APP_SERVER_TERMINATION,
      login: AUTH_LOGIN_TERMINATION,
      authCommand: AUTH_COMMAND_TERMINATION,
      spaceBroker: SPACE_BROKER_TERMINATION,
      plugin: PLUGIN_COMMAND_TERMINATION,
    }
    assert.deepEqual(
      Object.fromEntries(Object.entries(policies).map(([name, policy]) => [name, [policy.escalation, policy.tree]])),
      {
        core: ["graceful", false],
        login: ["graceful", false],
        authCommand: ["immediate", false],
        spaceBroker: ["immediate", false],
        plugin: ["graceful", true],
      },
    )
  })

  it("makes a tree-terminated child lead its own POSIX process group but keeps Windows consoles attached", () => {
    assert.deepEqual(terminationSpawnOptions(PLUGIN_COMMAND_TERMINATION, control("linux").control), { detached: true })
    assert.deepEqual(terminationSpawnOptions(PLUGIN_COMMAND_TERMINATION, control("darwin").control), { detached: true })
    assert.deepEqual(terminationSpawnOptions(PLUGIN_COMMAND_TERMINATION, control("win32").control), { detached: false })
    assert.deepEqual(terminationSpawnOptions(CORE_APP_SERVER_TERMINATION, control("linux").control), { detached: false })
  })

  it("rejects timeouts that setTimeout would turn into an immediate expiry", () => {
    assert.doesNotThrow(() => requirePositiveTimeout(undefined, "fixture"))
    assert.doesNotThrow(() => requirePositiveTimeout(1, "fixture"))
    assert.doesNotThrow(() => requirePositiveTimeout(2_147_483_647, "fixture"))
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => requirePositiveTimeout(value, "fixture close"), {
        message: `CodeM fixture close timeout must be positive: ${String(value)}`,
      })
    }
    for (const value of [2_147_483_648, 3e9]) {
      assert.throws(() => requirePositiveTimeout(value, "fixture close"), {
        message: `CodeM fixture close timeout must not exceed 2147483647ms: ${String(value)}`,
      })
    }
  })
})

describe("graceful termination escalation", () => {
  it("waits one step for a stdin-closed child to exit on its own before signalling", async () => {
    const child = fakeChild({ exitsAfterMs: STEP_MS / 2 })
    await terminateChildProcess(child.process, child.exited, graceful({ exitsOnStdinClose: true }))
    assert.deepEqual(child.signals, [])
  })

  it("stops at SIGTERM when the child honours it", async () => {
    const child = fakeChild({ exitsOn: "SIGTERM" })
    await terminateChildProcess(child.process, child.exited, graceful({ exitsOnStdinClose: true }))
    assert.deepEqual(child.signals, ["SIGTERM"])
  })

  it("escalates to SIGKILL one step after an ignored SIGTERM", async () => {
    const child = fakeChild({ exitsOn: "SIGKILL" })
    const started = performance.now()
    await terminateChildProcess(child.process, child.exited, graceful())
    assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"])
    assert.ok(performance.now() - started >= STEP_MS - 5, "SIGKILL must wait for the SIGTERM step")
  })

  it("reports a child that outlives every step, naming the steps it went through", async () => {
    const withEof = fakeChild({})
    await assert.rejects(
      terminateChildProcess(withEof.process, withEof.exited, graceful({ exitsOnStdinClose: true })),
      { message: "Fixture process did not exit after stdin close, SIGTERM, and SIGKILL" },
    )
    assert.deepEqual(withEof.signals, ["SIGTERM", "SIGKILL"])
    const withoutEof = fakeChild({})
    await assert.rejects(terminateChildProcess(withoutEof.process, withoutEof.exited, graceful()), {
      message: "Fixture process did not exit after SIGTERM and SIGKILL",
    })
  })

  it("does not signal a direct child that has already exited", async () => {
    const child = fakeChild({ exitsAfterMs: 0 })
    await child.exited
    await terminateChildProcess(child.process, child.exited, graceful())
    assert.deepEqual(child.signals, [])
  })

  it("propagates a failed exit promise instead of treating it as an exit", async () => {
    const child = fakeChild({})
    child.fail(new Error("spawn failed"))
    await assert.rejects(terminateChildProcess(child.process, child.exited, graceful()), /spawn failed/)
  })
})

describe("immediate termination", () => {
  it("sends SIGKILL synchronously and waits for the exit without a bound", async () => {
    const child = fakeChild({})
    let settled = false
    const terminating = terminateChildProcess(child.process, child.exited, SPACE_BROKER_TERMINATION).then(() => {
      settled = true
    })
    assert.deepEqual(child.signals, ["SIGKILL"])
    await delay(STEP_MS * 3)
    assert.equal(settled, false, "Immediate termination must keep waiting for the caller's exit")
    child.exit("SIGKILL")
    await terminating
    assert.equal(settled, true)
  })
})

describe("process tree signalling", () => {
  it("signals the POSIX process group even after the direct child exited", async () => {
    const child = fakeChild({ pid: 4242 })
    const posix = control("linux")
    child.markDirectChildExited()
    const terminating = terminateChildProcess(child.process, child.exited, graceful({ tree: true }), posix.control)
    await delay(STEP_MS * 1.5)
    child.exit(null)
    await terminating
    assert.deepEqual(posix.kills, [[-4242, "SIGTERM"], [-4242, "SIGKILL"]])
    assert.deepEqual(child.signals, [], "A tree policy must not fall back to the direct child when the group exists")
  })

  it("ignores a vanished POSIX group but signals the direct child when the group cannot be signalled", async () => {
    const gone = fakeChild({ pid: 4242 })
    const missing = control("linux", { killError: "ESRCH" })
    await assert.rejects(terminateChildProcess(gone.process, gone.exited, graceful({ tree: true }), missing.control))
    assert.deepEqual(gone.signals, [])
    const denied = fakeChild({ pid: 4243, exitsOn: "SIGKILL" })
    const eperm = control("linux", { killError: "EPERM" })
    await terminateChildProcess(denied.process, denied.exited, graceful({ tree: true }), eperm.control)
    assert.deepEqual(denied.signals, ["SIGTERM", "SIGKILL"])
  })

  it("runs taskkill for the Windows tree at each step and falls back to the child if taskkill cannot start", async () => {
    const child = fakeChild({ pid: 4242 })
    const windows = control("win32")
    await assert.rejects(terminateChildProcess(child.process, child.exited, graceful({ tree: true }), windows.control))
    const invocation = ["taskkill", ["/pid", "4242", "/t", "/f"], { stdio: "ignore", windowsHide: true }]
    assert.deepEqual(windows.spawns, [invocation, invocation])
    assert.deepEqual(windows.kills, [])
    assert.deepEqual(child.signals, [])

    const fallback = fakeChild({ pid: 4243, exitsOn: "SIGKILL" })
    const broken = control("win32", { spawnError: true })
    await terminateChildProcess(fallback.process, fallback.exited, graceful({ tree: true }), broken.control)
    assert.deepEqual(fallback.signals, ["SIGKILL"])
  })

  it("does nothing for a tree child that never received a pid", async () => {
    const child = fakeChild({ pid: undefined, exitsAfterMs: STEP_MS / 2 })
    const posix = control("linux")
    await terminateChildProcess(child.process, child.exited, graceful({ tree: true }), posix.control)
    assert.deepEqual(posix.kills, [])
  })
})

describe("real child processes", () => {
  it("lets a child exit on stdin close without any signal", async () => {
    const child = spawnNode("process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); setInterval(() => {}, 1000)")
    child.process.stdin?.end()
    await terminateChildProcess(child.process, child.closed, CORE_APP_SERVER_TERMINATION)
    assert.deepEqual(await child.closed, { code: 0, signal: null })
  })

  it("kills a child immediately", async () => {
    const child = spawnNode("setInterval(() => {}, 1000)")
    await terminateChildProcess(child.process, child.closed, AUTH_COMMAND_TERMINATION)
    assert.equal(child.process.killed, true)
    assert.notEqual((await child.closed).code, 0)
  })

  it("escalates a child that ignores SIGTERM to SIGKILL", { skip: process.platform === "win32" }, async () => {
    const root = temporaryDirectory()
    const marker = join(root, "sigterm")
    const child = spawnNode(
      `process.on('SIGTERM', () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'SIGTERM')); setInterval(() => {}, 1000); console.log('ready')`,
    )
    await child.line(line => line === "ready")
    await terminateChildProcess(child.process, child.closed, { ...AUTH_LOGIN_TERMINATION, stepTimeoutMs: 100 })
    assert.deepEqual(await child.closed, { code: null, signal: "SIGKILL" })
    assert.equal(readFileSync(marker, "utf8"), "SIGTERM")
  })

  it("reaps a helper that ignores SIGTERM and holds the command's stdout", { skip: process.platform === "win32" }, async () => {
    const helperSource = "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"
    const child = spawnNode(
      `process.on('SIGTERM', () => {}); const helper = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(helperSource)}], { stdio: ['ignore', 'inherit', 'inherit'] }); console.log('helper ' + helper.pid); setInterval(() => {}, 1000)`,
      terminationSpawnOptions(PLUGIN_COMMAND_TERMINATION),
    )
    const [helperLine] = await Promise.all([child.line(line => line.startsWith("helper ")), child.line(line => line === "ready")])
    const helperPid = Number(helperLine.slice("helper ".length))
    assert.ok(Number.isInteger(helperPid) && helperPid > 0, `helper pid must be reported, got ${helperPid}`)
    cleanups.push(() => forceKill(helperPid))
    await terminateChildProcess(child.process, child.closed, { ...PLUGIN_COMMAND_TERMINATION, stepTimeoutMs: 100 })
    assert.equal((await child.closed).signal, "SIGKILL")
    // The orphaned helper is re-parented and reaped shortly after it dies.
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(helperPid, 0) } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, "ESRCH")
        return
      }
      await delay(20)
    }
    assert.fail("The helper survived process tree termination")
  })
})

interface FakeChildOptions {
  readonly pid?: number | undefined
  readonly exitsOn?: "SIGTERM" | "SIGKILL"
  readonly exitsAfterMs?: number
}

function fakeChild(options: FakeChildOptions) {
  const signals: NodeJS.Signals[] = []
  let resolveExit!: () => void
  let rejectExit!: (error: Error) => void
  const exited = new Promise<void>((resolve, reject) => {
    resolveExit = resolve
    rejectExit = reject
  })
  const fake = Object.assign(new EventEmitter(), {
    pid: "pid" in options ? options.pid : 4242,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill(signal: NodeJS.Signals): boolean {
      signals.push(signal)
      // A child that honours some signal always dies on SIGKILL.
      if (options.exitsOn && (signal === options.exitsOn || signal === "SIGKILL")) exit(signal)
      return true
    },
  })
  const exit = (signal: NodeJS.Signals | null): void => {
    if (signal) fake.signalCode = signal
    else fake.exitCode ??= 0
    resolveExit()
  }
  if (options.exitsAfterMs !== undefined) setTimeout(() => exit(null), options.exitsAfterMs)
  return {
    process: fake as unknown as ChildProcess,
    exited,
    signals,
    exit,
    /** The direct child has exited while its stdio (held by tree members) is still open. */
    markDirectChildExited: () => { fake.exitCode = 0 },
    fail: (error: Error) => {
      rejectExit(error)
      exited.catch(() => undefined)
    },
  }
}

function control(platform: NodeJS.Platform, options: { readonly killError?: string; readonly spawnError?: boolean } = {}) {
  const kills: Array<[number, NodeJS.Signals]> = []
  const spawns: unknown[][] = []
  const fakeSpawn = (...args: unknown[]) => {
    spawns.push(args)
    const killer = new EventEmitter()
    if (options.spawnError) queueMicrotask(() => killer.emit("error", new Error("taskkill missing")))
    return killer
  }
  const processControl: ProcessControl = {
    platform,
    spawn: fakeSpawn as unknown as ProcessControl["spawn"],
    kill: (pid, signal) => {
      if (options.killError) throw Object.assign(new Error(options.killError), { code: options.killError })
      kills.push([pid, signal])
    },
  }
  return { control: processControl, kills, spawns }
}

function spawnNode(source: string, extra: { readonly detached?: boolean } = {}) {
  const child = spawn(process.execPath, ["-e", source], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, ...extra })
  let open = true
  const closed = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve) => {
    child.once("close", (code, signal) => {
      open = false
      resolve({ code, signal })
    })
  })
  cleanups.push(() => {
    if (open && child.pid) forceKill(extra.detached ? -child.pid : child.pid)
  })
  const lines = createInterface({ input: child.stdout })
  const seen: string[] = []
  const waiters: Array<{ readonly match: (line: string) => boolean; readonly resolve: (line: string) => void }> = []
  lines.on("line", (line) => {
    seen.push(line)
    for (const waiter of waiters.splice(0)) {
      if (waiter.match(line)) waiter.resolve(line)
      else waiters.push(waiter)
    }
  })
  const line = (match: (line: string) => boolean): Promise<string> => {
    const existing = seen.find(match)
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise(resolve => waiters.push({ match, resolve }))
  }
  return { process: child, closed, line }
}

/** Negative pids address a process group; 0 would address the test runner's own group, so it is refused. */
function forceKill(pid: number): void {
  if (!Number.isInteger(pid) || pid === 0) return
  try { process.kill(pid, "SIGKILL") } catch { /* already gone */ }
}

function temporaryDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "codem-process-lifecycle-"))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
