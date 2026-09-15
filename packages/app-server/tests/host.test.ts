import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import {
  AppServerHost,
  DEFAULT_APP_SERVER_THREAD_SETTINGS,
  REQUIRED_APP_SERVER_BOOLEAN_CAPABILITIES,
  REQUIRED_APP_SERVER_ITEM_STATUSES,
  REQUIRED_APP_SERVER_ITEM_TYPES,
  appServerHostEnvironment,
  type AppServerHostEvent,
  type AppServerRuntime,
} from "../src/index.ts"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("AppServerHost", () => {
  it("uses the current main thread contract and projects one correlated turn", async () => {
    const fixture = createFixture()
    const events: AppServerHostEvent[] = []
    let resolveCompleted!: () => void
    const completed = new Promise<void>((resolve) => {
      resolveCompleted = resolve
    })
    let authenticationChecks = 0
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "host-test", version: "1.0.0" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath },
      assertAuthenticated: () => {
        authenticationChecks += 1
      },
    })
    host.onEvent((event) => {
      events.push(event)
      if (event.type === "turn-completed") resolveCompleted()
    })

    const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
    assert.equal(threadId, "thread-1")
    const turnId = await host.startTurn({
      cwd: fixture.root,
      threadId,
      submissionId: "submission-1",
      text: "Build it",
    })
    assert.equal(turnId, "turn-1")
    await completed
    assert.equal(authenticationChecks, 1)
    assert.equal(events.filter((event) => event.type === "turn-started").length, 1)
    assert.deepEqual(
      events.flatMap((event) => (event.type === "text-delta" ? [event.delta] : [])),
      ["Done"],
    )
    assert.equal(events.filter((event) => event.type === "turn-completed").length, 1)

    await host.unsubscribeThread(fixture.root, threadId)
    await host.resumeThread(fixture.root, threadId, {
      ...DEFAULT_APP_SERVER_THREAD_SETTINGS,
      permissionMode: "yolo",
      workMode: "plan",
    })
    await host.close()

    const captured = readFileSync(fixture.capturePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.deepEqual(captured[0]?.argv, ["--final-answer-tool", "app-server", "app-server"])
    assert.deepEqual((captured[0]?.environment as Record<string, unknown>).credentialHost, [
      "/bin/true",
      "__host-serve",
    ])
    const start = captured.find((entry) => entry.method === "thread/start")?.params as Record<string, unknown>
    assert.equal(start.permissionMode, "auto")
    assert.equal(start.executionMode, "default")
    const resume = captured.find((entry) => entry.method === "thread/resume")?.params as Record<string, unknown>
    assert.equal("permissionMode" in resume, false)
    assert.equal("executionMode" in resume, false)
  })

  it("removes inherited broker commands before installing the bundled broker", () => {
    const fixture = createFixture()
    const environment = appServerHostEnvironment(fixture.runtime, {
      PATH: process.env.PATH,
      codem_router_credential_host_cmd: "untrusted",
      CODEM_SESSION_SOURCE: "untrusted",
    })
    assert.equal(environment.codem_router_credential_host_cmd, undefined)
    assert.deepEqual(JSON.parse(environment.CODEM_ROUTER_CREDENTIAL_HOST_CMD!), ["/bin/true", "__host-serve"])
    assert.equal(environment.CODEM_SESSION_SOURCE, "vscode")
  })
})

function createFixture(): { readonly root: string; readonly capturePath: string; readonly runtime: AppServerRuntime } {
  const root = mkdtempSync(join(tmpdir(), "codem-host-"))
  temporaryDirectories.push(root)
  const executablePath = join(root, "codem-core")
  const capturePath = join(root, "capture.jsonl")
  writeFileSync(executablePath, fixtureSource(completeCapabilities()))
  chmodSync(executablePath, 0o755)
  return {
    root,
    capturePath,
    runtime: {
      target: "darwin-arm64",
      packageName: "@lark-codem/codem-core-darwin-arm64",
      coreVersion: "0.8.37",
      executablePath,
      licensePath: join(root, "LICENSE.core"),
      authPackageName: "@lark-codem/codem-cli-darwin-arm64",
      cliVersion: "0.1.208",
      authExecutablePath: "/bin/true",
      authLicensePath: join(root, "LICENSE.auth"),
    },
  }
}

function fixtureSource(capabilities: Record<string, unknown>): string {
  return `#!/usr/bin/env node
const fs = require("node:fs")
const readline = require("node:readline")
const capture = (value) => fs.appendFileSync(process.env.CAPTURE_PATH, JSON.stringify(value) + "\\n")
capture({ argv: process.argv.slice(2), environment: { credentialHost: JSON.parse(process.env.CODEM_ROUTER_CREDENTIAL_HOST_CMD), source: process.env.CODEM_SESSION_SOURCE } })
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n")
const lines = readline.createInterface({ input: process.stdin })
lines.on("close", () => process.exit(0))
lines.on("line", (line) => {
  const frame = JSON.parse(line)
  if (!Object.prototype.hasOwnProperty.call(frame, "id")) return
  capture({ method: frame.method, params: frame.params })
  if (frame.method === "initialize") return send({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: 1, agentInfo: { version: "0.8.37+1.gfixture" }, capabilities: ${JSON.stringify(capabilities)} } })
  if (frame.method === "thread/start") return send({ jsonrpc: "2.0", id: frame.id, result: { thread: { id: "thread-1" } } })
  if (frame.method === "thread/resume") return send({ jsonrpc: "2.0", id: frame.id, result: { thread: { id: frame.params.threadId } } })
  if (frame.method === "turn/start") {
    send({ jsonrpc: "2.0", method: "turn/started", params: { threadId: frame.params.threadId, turn: { id: "turn-1" } } })
    send({ jsonrpc: "2.0", id: frame.id, result: { turn: { id: "turn-1" } } })
    send({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "item-1", delta: "Done" } })
    return send({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: frame.params.threadId, turn: { id: "turn-1", status: "completed", stopReason: "end_turn", error: null } } })
  }
  send({ jsonrpc: "2.0", id: frame.id, result: {} })
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
    const next = current[segment]
    if (typeof next === "object" && next !== null && !Array.isArray(next)) current = next as Record<string, unknown>
    else {
      const created: Record<string, unknown> = {}
      current[segment] = created
      current = created
    }
  }
  current[segments.at(-1)!] = value
}
