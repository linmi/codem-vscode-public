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
    assert.deepEqual(
      events.flatMap((event) => (event.type === "item-output-delta" ? [event.delta] : [])),
      ["running pwd"],
    )
    assert.equal(events.filter((event) => event.type === "tool-guard").length, 1)
    assert.deepEqual(
      events.flatMap((event) => (event.type === "file-diff" ? [event.diff] : [])),
      [
        {
          source: { kind: "tool", toolCallId: "call-1" },
          path: "src/example.ts",
          changeType: "modified",
          stats: { linesAdded: 1, linesRemoved: 0 },
          preview: {
            kind: "complete",
            hunks: [
              {
                oldStart: 1,
                oldCount: 1,
                newStart: 1,
                newCount: 2,
                lines: [
                  { kind: "context", oldLine: 1, newLine: 1, text: "const before = true" },
                  { kind: "insert", oldLine: null, newLine: 2, text: "const after = true" },
                ],
              },
            ],
          },
        },
      ],
    )
    assert.equal(events.filter((event) => event.type === "hook-completed").length, 1)
    assert.deepEqual(
      events.flatMap((event) => (event.type === "background-wake" ? [`${event.phase}:${event.taskId}`] : [])),
      ["queued:task-1", "started:task-1", "skipped:task-2"],
    )
    assert.equal(events.filter((event) => event.type === "diff-updated").length, 1)
    assert.equal(
      events.filter((event) => event.type === "item-completed" && event.item.id === "snapshot-only").length,
      1,
    )
    assert.equal(events.filter((event) => event.type === "turn-completed").length, 1)

    assert.deepEqual(await host.readThread(fixture.root, threadId), {
      id: "thread-1",
      cwd: fixture.root,
      archived: false,
      model: "codem/auto",
      profile: "default",
      startedAt: "2026-09-15T00:00:00.000Z",
      status: "idle",
    })
    assert.deepEqual(await host.listTurns(fixture.root, threadId, { limit: 20, sortDirection: "asc" }), {
      entries: [
        {
          id: "turn-1",
          input: "Build it",
          submissionId: "submission-1",
          startedAt: "2026-09-15T00:00:01.000Z",
          completedAt: "2026-09-15T00:00:02.000Z",
          status: "completed",
          itemsView: "summary",
        },
      ],
      nextCursor: null,
      total: 1,
    })
    assert.deepEqual(await host.listItems(fixture.root, threadId, { turnId, limit: 50, sortDirection: "asc" }), {
      entries: [
        {
          id: "item-1",
          type: "agentMessage",
          turnId: "turn-1",
          submissionId: "submission-1",
          recordSeq: 1,
          status: "completed",
          callId: null,
          toolName: null,
          input: null,
          text: "Done",
          summary: "",
          output: "",
          label: "agentMessage",
          isError: false,
          subagentId: null,
          subagentKind: null,
          replaced: null,
          kept: null,
          finalAnswer: null,
        },
        {
          id: "result-1",
          type: "toolResult",
          turnId: "turn-1",
          submissionId: null,
          recordSeq: 2,
          status: "completed",
          callId: "call-1",
          toolName: null,
          input: null,
          text: "",
          summary: "",
          output: "Done",
          label: "toolResult",
          isError: false,
          subagentId: null,
          subagentKind: null,
          replaced: null,
          kept: null,
          finalAnswer: null,
        },
      ],
      nextCursor: null,
      total: 2,
    })

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
    assert.deepEqual(captured[0]?.argv, ["--final-answer-tool", "app-server"])
    assert.deepEqual((captured[0]?.environment as Record<string, unknown>).credentialHost, [
      "/bin/true",
      "__host-serve",
    ])
    const start = captured.find((entry) => entry.method === "thread/start")?.params as Record<string, unknown>
    assert.equal(start.permissionMode, "auto")
    assert.equal(start.executionMode, "default")
    assert.deepEqual(start.extensions, { codem: { intelligence: "medium" } })
    const resume = captured.find((entry) => entry.method === "thread/resume")?.params as Record<string, unknown>
    assert.equal("permissionMode" in resume, false)
    assert.equal("executionMode" in resume, false)
  })

  it("reads, changes and broadcasts per-thread modes without accepting stale or cross-workspace writes", async () => {
    const fixture = createFixture()
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "mode-test", version: "1" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath },
      assertAuthenticated: () => {},
    })
    const events: AppServerHostEvent[] = []
    host.onEvent((event) => events.push(event))
    try {
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      await host.resumeThread(fixture.root, "thread-2", DEFAULT_APP_SERVER_THREAD_SETTINGS)
      assert.equal((await host.readModes(fixture.root, threadId)).permissionMode, "default")
      const updated = await host.setModes({ cwd: fixture.root, threadId, expectedRevision: 0, permissionMode: "auto" })
      assert.deepEqual(updated, { revision: 1, permissionEpoch: 1, permissionMode: "auto", workMode: "normal" })
      await assert.rejects(
        host.setModes({ cwd: fixture.root, threadId, expectedRevision: 0, permissionMode: "yolo" }),
        /revision conflict/,
      )
      assert.equal((await host.readModes(fixture.root, "thread-2")).permissionMode, "default")
      await assert.rejects(
        host.setModes({ cwd: "/other", threadId, expectedRevision: 1, permissionMode: "yolo" }),
        /another workspace/,
      )
      await assert.rejects(
        host.setModes({ cwd: fixture.root, threadId, expectedRevision: 1, permissionMode: "acceptEdits" as never }),
        /permissionMode/,
      )
      assert.equal(
        events.filter((event) => event.type === "thread-modes-updated" && event.threadId === threadId).length,
        2,
      )
      await host.unsubscribeThread(fixture.root, threadId)
      await assert.rejects(host.readModes(fixture.root, threadId), /not loaded/)
      await host.resumeThread(fixture.root, threadId, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      assert.equal((await host.readModes(fixture.root, threadId)).permissionMode, "auto")
    } finally {
      await host.close()
    }
  })

  it("rejects the obsolete empty unsubscribe result instead of pretending the thread was released", async () => {
    const fixture = createFixture()
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "mode-test", version: "1" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath, OLD_UNSUBSCRIBE_RESULT: "1" },
      assertAuthenticated: () => {},
    })
    try {
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      await assert.rejects(host.unsubscribeThread(fixture.root, threadId), /unsubscribe status/)
    } finally {
      await host.close()
    }
  })

  it("rejects an in-flight mode response after the thread is retired", async () => {
    const fixture = createFixture()
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "mode-test", version: "1" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath, DELAY_MODE_READ: "1" },
      assertAuthenticated: () => {},
    })
    try {
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      const reading = host.readModes(fixture.root, threadId)
      const rejected = assert.rejects(reading, /retired thread/)
      await host.unsubscribeThread(fixture.root, threadId)
      await rejected
    } finally {
      await host.close()
    }
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
const modes = new Map()
const mode = (threadId) => modes.get(threadId) ?? { revision: 0, permissionEpoch: 0, permissionMode: "default", workMode: "normal" }
const lines = readline.createInterface({ input: process.stdin })
lines.on("close", () => process.exit(0))
lines.on("line", (line) => {
  const frame = JSON.parse(line)
  if (!Object.prototype.hasOwnProperty.call(frame, "id")) return
  capture({ method: frame.method, params: frame.params })
  if (frame.method === "initialize") return send({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: 1, agentInfo: { version: "0.8.37+1.gfixture" }, capabilities: ${JSON.stringify(capabilities)} } })
  if (frame.method === "thread/start") return send({ jsonrpc: "2.0", id: frame.id, result: { thread: { id: "thread-1" } } })
  if (frame.method === "thread/resume") return send({ jsonrpc: "2.0", id: frame.id, result: { thread: { id: frame.params.threadId } } })
  if (frame.method === "thread/unsubscribe") return send({ id: frame.id, result: process.env.OLD_UNSUBSCRIBE_RESULT ? {} : { status: "unsubscribed" } })
  if (frame.method === "thread/mode/read") {
    const result = { threadId: frame.params.threadId, state: mode(frame.params.threadId) }
    if (process.env.DELAY_MODE_READ) return setTimeout(() => send({ id: frame.id, result }), 50)
    return send({ id: frame.id, result })
  }
  if (frame.method === "thread/mode/set") {
    const previous = mode(frame.params.threadId)
    if (previous.revision !== frame.params.expectedRevision) return send({ id: frame.id, error: { code: -32003, message: "Session mode revision conflict", data: { kind: "sessionModeRevisionConflict" } } })
    const state = { ...previous, revision: previous.revision + 1, permissionEpoch: previous.permissionEpoch + (previous.permissionMode === frame.params.permissionMode ? 0 : 1), permissionMode: frame.params.permissionMode }
    modes.set(frame.params.threadId, state)
    const result = { threadId: frame.params.threadId, state }
    send({ method: "thread/mode/changed", params: result })
    send({ method: "thread/mode/changed", params: result })
    send({ method: "thread/mode/changed", params: { threadId: frame.params.threadId, state: previous } })
    return send({ id: frame.id, result })
  }
  if (frame.method === "thread/read") return send({ jsonrpc: "2.0", id: frame.id, result: { thread: { id: "thread-1", cwd: require("node:path").dirname(process.env.CAPTURE_PATH), archived: false, model: "codem/auto", profile: "default", startedAt: "2026-09-15T00:00:00.000Z", status: "idle" } } })
  if (frame.method === "thread/turns/list") return send({ jsonrpc: "2.0", id: frame.id, result: { turns: [{ id: "turn-1", input: "Build it", submissionId: "submission-1", startedAt: "2026-09-15T00:00:01.000Z", completedAt: "2026-09-15T00:00:02.000Z", status: "completed", itemsView: "summary" }], nextCursor: null, total: 1 } })
  if (frame.method === "thread/items/list") return send({ jsonrpc: "2.0", id: frame.id, result: { items: [{ id: "item-1", type: "agentMessage", submissionId: "submission-1", recordSeq: 1, status: "completed", text: "Done" }, { id: "result-1", type: "toolResult", callId: "call-1", recordSeq: 2, status: "completed", output: "Done" }], nextCursor: null, total: 2 } })
  if (frame.method === "turn/start") {
    send({ jsonrpc: "2.0", method: "turn/started", params: { threadId: frame.params.threadId, turn: { id: "turn-1" } } })
    send({ jsonrpc: "2.0", id: frame.id, result: { turn: { id: "turn-1" } } })
    send({ jsonrpc: "2.0", method: "item/started", params: { threadId: frame.params.threadId, turnId: "turn-1", item: { id: "tool-1", type: "commandExecution", status: "inProgress", tool: "run_bash", callId: "call-1", arguments: { command: "pwd" } } } })
    send({ jsonrpc: "2.0", method: "item/commandExecution/outputDelta", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "tool-1", delta: "running pwd" } })
    send({ jsonrpc: "2.0", method: "item/toolCall/guardUpdated", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "tool-1", callId: "call-1", guard: { tool: "run_bash", status: "pass", reason: "ok", rawResultBytes: null, returnedResultBytes: 11, formattedCapBytes: null, globalBackstopApplied: false, suggestion: null } } })
    const diff = JSON.stringify({ tool_call_id: "call-1", path: "src/example.ts", change_type: "modified", is_binary: false, truncated: false, stats: { lines_added: 1, lines_removed: 0 }, hunks: [{ old_start: 1, old_count: 1, new_start: 1, new_count: 2, lines: [{ kind: "context", old_line: 1, new_line: 1, text: "const before = true" }, { kind: "insert", old_line: null, new_line: 2, text: "const after = true" }] }], raw_unified: null })
    const split = Math.floor(diff.length / 2)
    send({ jsonrpc: "2.0", method: "item/fileChange/delta", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "diff-1", callId: "call-1", sequence: 0, delta: diff.slice(0, split), encoding: "json", complete: false } })
    send({ jsonrpc: "2.0", method: "item/fileChange/delta", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "diff-1", callId: "call-1", sequence: 1, delta: diff.slice(split), encoding: "json", complete: true } })
    send({ jsonrpc: "2.0", method: "item/completed", params: { threadId: frame.params.threadId, turnId: "turn-1", item: { id: "tool-1", type: "commandExecution", status: "completed", callId: "call-1", summary: "exit 0", output: "/workspace", isError: false } } })
    send({ jsonrpc: "2.0", method: "hook/completed", params: { threadId: frame.params.threadId, turnId: "turn-1", run: { event: "PostToolUse", tool: "run_bash", command: "check.sh", outcome: "success", reason: "ok", elapsedMs: 12 } } })
    send({ jsonrpc: "2.0", method: "backgroundTask/wakeQueued", params: { threadId: frame.params.threadId, turnId: "turn-1", taskId: "task-1" } })
    send({ jsonrpc: "2.0", method: "backgroundTask/wakeStarted", params: { threadId: frame.params.threadId, turnId: "turn-1", taskId: "task-1" } })
    send({ jsonrpc: "2.0", method: "backgroundTask/wakeSkipped", params: { threadId: frame.params.threadId, turnId: "turn-1", taskId: "task-2" } })
    send({ jsonrpc: "2.0", method: "turn/diff/updated", params: { threadId: frame.params.threadId, turnId: "turn-1", diff: [{ path: "src/example.ts", linesAdded: 1, linesRemoved: 0 }] } })
    send({ jsonrpc: "2.0", method: "item/started", params: { threadId: frame.params.threadId, turnId: "turn-1", item: { id: "item-1", type: "agentMessage", status: "inProgress" } } })
    send({ jsonrpc: "2.0", method: "item/agentMessage/delta", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "item-1", delta: "Done" } })
    send({ jsonrpc: "2.0", method: "item/completed", params: { threadId: frame.params.threadId, turnId: "turn-1", item: { id: "item-1", type: "agentMessage", status: "completed", text: "Done" } } })
    return send({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: frame.params.threadId, turn: { id: "turn-1", status: "completed", stopReason: "end_turn", error: null, items: [{ id: "snapshot-only", type: "toolCall", status: "interrupted", tool: "read_file", callId: "call-snapshot", summary: "Turn ended" }, { id: "snapshot-result", type: "toolResult", status: "completed", callId: "call-snapshot", output: "Done" }] } } })
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
