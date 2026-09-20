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
  it("accepts correlated Core activity without replacing text or changing terminal ownership", { timeout: 5000 }, async () => {
    const fixture = createFixture(undefined, [
      { method: "turn/activity", params: { source: "provider_stream" } },
      { method: "turn/activity", params: { source: "provider_stream" } },
      { method: "turn/activity", params: { threadId: "foreign", source: "provider_stream" } },
      { method: "turn/activity", params: { turnId: "stale", source: "provider_stream" } },
      { method: "item/agentMessage/delta", params: { delta: "Still connected" } },
    ])
    const host = new AppServerHost({ runtime: fixture.runtime, clientInfo: { name: "activity-test", version: "1" }, assertAuthenticated() {}, environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath } })
    const events: AppServerHostEvent[] = []
    const finished = new Promise<void>((resolve, reject) => host.onEvent(event => {
      events.push(event)
      if (event.type === "protocol-error") reject(new Error(event.message))
      if (event.type === "turn-activity") assert.equal(host.hasActiveWork, true)
      if (event.type === "turn-completed") resolve()
    }))
    try {
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      await host.startTurn({ cwd: fixture.root, threadId, submissionId: "activity", text: "Hello" })
      await finished
      assert.deepEqual(events.filter(event => event.type === "turn-activity"), Array.from({ length: 2 }, () => ({ type: "turn-activity", threadId, turnId: "turn-1", source: "provider_stream" })))
      assert.deepEqual(events.flatMap(event => event.type === "text-delta" ? [event.delta] : []), ["Still connected"])
      assert.equal(events.filter(event => event.type === "turn-completed").length, 1)
      assert.equal(host.hasActiveWork, false)
      await host.readModes(fixture.root, threadId)
    } finally { await host.close() }
  })

  for (const params of [{}, { source: null }, { source: 42 }, { source: " " }, { source: "provider_stream", turnId: null }]) {
    it(`rejects invalid activity ${JSON.stringify(params)}`, { timeout: 5000 }, async () => {
      const fixture = createFixture(undefined, [{ method: "turn/activity", params }])
      const host = new AppServerHost({ runtime: fixture.runtime, clientInfo: { name: "activity-test", version: "1" }, assertAuthenticated() {}, environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath } })
      const events: AppServerHostEvent[] = []
      const failed = new Promise<string>(resolve => host.onEvent(event => { events.push(event); if (event.type === "protocol-error") resolve(event.message) }))
      try {
        const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
        await host.startTurn({ cwd: fixture.root, threadId, submissionId: "invalid-activity", text: "Hello" })
        assert.match(await failed, /turn\/activity/)
        assert.equal(events.some(event => event.type === "turn-activity" || event.type === "turn-completed"), false)
      } finally { await host.close() }
    })
  }

  it("uses native structured skill input and rejects blank skill names", { timeout: 5000 }, async () => {
    const fixture = createFixture()
    const host = new AppServerHost({ runtime: fixture.runtime, clientInfo: { name: "skill-test", version: "1" }, assertAuthenticated() {}, environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath } })
    try {
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      await assert.rejects(host.startTurn({ cwd: fixture.root, threadId, submissionId: "invalid", text: "args", skillName: " " }), /skill name/)
      const completed = new Promise<void>((resolve, reject) => host.onEvent(event => { if (event.type === "turn-completed") resolve(); if (event.type === "protocol-error") reject(new Error(event.message)) }))
      await host.startTurn({ cwd: fixture.root, threadId, submissionId: "skill", text: "args", skillName: "fixture-skill" })
      await completed
      const request = readFileSync(fixture.capturePath, "utf8").trim().split("\n").map(line => JSON.parse(line)).find(entry => entry.method === "turn/start")
      assert.deepEqual(request.params.input, { type: "skill", name: "fixture-skill", arguments: "args" })
    } finally { await host.close() }
  })

  for (const invalid of ["operation", "source", "same-id", "cwd", "status"]) {
    it(`rejects an invalid clear target (${invalid}) without registering it`, { timeout: 5000 }, async () => {
      const fixture = createFixture()
      const host = new AppServerHost({ runtime: fixture.runtime, clientInfo: { name: "clear-test", version: "1" }, assertAuthenticated() {}, environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath, INVALID_CLEAR: invalid } })
      try {
        const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
        await assert.rejects(host.clearThread(fixture.root, threadId, "operation"), /clear/)
        await assert.rejects(host.readModes(fixture.root, "cleared-thread"), /not loaded/)
      } finally { await host.close() }
    })
  }

  for (const scenario of [
    { method: "thread/unsubscribe", hold: "", stubborn: false },
    { method: "turn/interrupt", hold: "turn", stubborn: false },
    { method: "thread/sideQuestion/cancel", hold: "question", stubborn: false },
    { method: "thread/unsubscribe", hold: "", stubborn: true },
  ]) {
    it(`shutdown gate: reaps Core when ${scenario.method} hangs${scenario.stubborn ? " and EOF/SIGTERM are ignored" : ""}`, { timeout: 12_000 }, async () => {
      const fixture = createFixture(undefined, [])
      const host = new AppServerHost({ runtime: fixture.runtime, clientInfo: { name: "shutdown-test", version: "1" }, assertAuthenticated() {}, environment: {
        PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath,
        SHUTDOWN_HANG: scenario.method, SHUTDOWN_HOLD: scenario.hold, ...(scenario.stubborn ? { IGNORE_SHUTDOWN: "1" } : {}),
      } })
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      const pid: number = JSON.parse(readFileSync(fixture.capturePath, "utf8").split("\n")[0]!).pid
      const kill = () => { try { process.kill(pid, "SIGKILL") } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error } }
      // Independent watchdog also reaps the fixture when the implementation regresses.
      let watchdogFired = false
      const watchdog = setTimeout(() => { watchdogFired = true; kill() }, 9_000)
      try {
        if (scenario.hold === "turn") await host.startTurn({ cwd: fixture.root, threadId, submissionId: "shutdown", text: "hold" })
        if (scenario.hold === "question") await host.startSideQuestion(fixture.root, threadId, "shutdown", "hold")
        const start = performance.now()
        const closing = host.close()
        assert.equal(host.close(), closing)
        await closing
        const elapsed = performance.now() - start
        assert.equal(watchdogFired, false, "Host relied on test watchdog instead of terminating Core")
        assert.ok(elapsed < 8_000, `Shutdown exceeded budget: ${elapsed}ms`)
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "The child must actually be reaped")
        const records = readFileSync(fixture.capturePath, "utf8").trim().split("\n").map(line => JSON.parse(line))
        assert.equal(records.filter(record => record.method === scenario.method).length, 1)
        assert.ok(records.some(record => record.stdinClosed))
        if (scenario.stubborn) assert.ok(records.some(record => record.signal === "SIGTERM"))
        assert.equal(host.hasActiveWork, false)
      } finally { clearTimeout(watchdog); kill(); await host.close() }
    })
  }

  it("delivers idle background wakes and Core-owned turns without reviving completed turns", { timeout: 5000 }, async () => {
    const fixture = createFixture()
    const host = new AppServerHost({ runtime: fixture.runtime, clientInfo: { name: "background-test", version: "1" }, environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath, BACKGROUND_AFTER_TURN: "1" }, assertAuthenticated: () => {} })
    const events: AppServerHostEvent[] = []
    const finished = new Promise<void>((resolve, reject) => host.onEvent((event) => {
      events.push(event)
      if (event.type === "turn-completed" && event.turnId === "wake-turn") resolve()
      if (event.type === "protocol-error") reject(new Error(event.message))
    }))
    try {
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      await host.startTurn({ cwd: fixture.root, threadId, submissionId: "user-message", text: "Start background task" })
      await finished
      await host.readModes(fixture.root, threadId)
      assert.equal(host.hasActiveWork, false)
      assert.equal(events.filter((event) => event.type === "background-wake" && event.taskId === "idle-task").length, 2)
      assert.deepEqual(events.filter((event) => event.type === "turn-started").map((event) => [event.turnId, event.submissionId]), [["turn-1", "user-message"], ["wake-turn", null]])
      assert.equal(events.filter((event) => event.type === "turn-completed").length, 2)
      assert.deepEqual(events.flatMap((event) => event.type === "text-delta" && event.turnId === "wake-turn" ? [event.delta] : []), ["Background finished"])
    } finally { await host.close() }
  })

  for (const method of ["item/agentMessage/delta", "item/reasoning/textDelta", "thread/sideQuestion/delta"] as const) {
    for (const field of ["delta", "deltaText"] as const) {
      it(`preserves whitespace in ${method} ${field} without closing the connection`, { timeout: 5000 }, async () => {
        const chunks = ["before", " ", "\n", "\r\n", "\t", "", "  after  "]
        const fixture = createFixture(
          undefined,
          chunks.map((chunk) => ({ method, params: { [field]: chunk } })),
        )
        const host = new AppServerHost({
          runtime: fixture.runtime,
          clientInfo: { name: "text-delta-test", version: "1" },
          environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath },
          assertAuthenticated: () => {},
        })
        const events: AppServerHostEvent[] = []
        const completed = new Promise<void>((resolve, reject) =>
          host.onEvent((event) => {
            events.push(event)
            if (event.type === "turn-completed" || event.type === "side-question-completed") resolve()
            if (event.type === "protocol-error") reject(new Error(event.message))
          }),
        )
        void completed.catch(() => {})
        try {
          const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
          if (method === "thread/sideQuestion/delta") {
            await host.startSideQuestion(fixture.root, threadId, "whitespace", "Hello")
          } else {
            await host.startTurn({ cwd: fixture.root, threadId, submissionId: "whitespace", text: "Hello" })
          }
          await completed
          const eventType =
            method === "item/agentMessage/delta"
              ? "text-delta"
              : method === "item/reasoning/textDelta"
                ? "reasoning-delta"
                : "side-question-delta"
          assert.deepEqual(
            events.flatMap((event) => (event.type === eventType ? [event.delta] : [])),
            chunks.filter((chunk) => chunk.length > 0),
          )
          assert.equal(
            events.some((event) => event.type === "connection-closed"),
            false,
          )
          assert.equal((await host.readModes(fixture.root, threadId)).permissionMode, "default")
        } finally {
          await host.close()
        }
      })
    }
  }

  for (const params of [
    {},
    { delta: null },
    { delta: 42 },
    { delta: false },
    { delta: [] },
    { deltaText: {} },
    { delta: "valid", deltaText: 42 },
    { delta: false, deltaText: "valid" },
    { delta: " ", deltaText: "\n" },
  ]) {
    it(`rejects malformed text delta ${JSON.stringify(params)}`, { timeout: 5000 }, async () => {
      const fixture = createFixture(undefined, [{ method: "item/agentMessage/delta", params }])
      const host = new AppServerHost({
        runtime: fixture.runtime,
        clientInfo: { name: "text-delta-test", version: "1" },
        environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath },
        assertAuthenticated: () => {},
      })
      const events: AppServerHostEvent[] = []
      const closed = new Promise<void>((resolve) =>
        host.onEvent((event) => {
          events.push(event)
          if (event.type === "connection-closed" || event.type === "turn-completed") resolve()
        }),
      )
      try {
        const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
        await host.startTurn({ cwd: fixture.root, threadId, submissionId: "malformed", text: "Hello" })
        await closed
        const error = events.find((event) => event.type === "protocol-error")
        assert.ok(error, "invalid text delta must fail closed")
        assert.match(error.message, /item\/agentMessage\/delta/)
        assert.equal(
          events.some((event) => event.type === "text-delta" || event.type === "turn-completed"),
          false,
        )
      } finally {
        await host.close()
      }
    })
  }

  for (const [field, value] of [
    ["tool", null],
    ["tool", " "],
    ["reason", 42],
    ["reason", undefined],
    ["elapsedMs", -1],
  ] as const) {
    it(`rejects malformed hook ${field}=${String(value)} without projecting it`, { timeout: 5000 }, async () => {
      const fixture = createFixture({
        event: "SessionStart",
        tool: "",
        command: "check.sh",
        outcome: "allow",
        reason: null,
        elapsedMs: 12,
        [field]: value,
      })
      const host = new AppServerHost({
        runtime: fixture.runtime,
        clientInfo: { name: "hook-test", version: "1" },
        environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath },
        assertAuthenticated: () => {},
      })
      const events: AppServerHostEvent[] = []
      const failed = new Promise<string>((resolve) =>
        host.onEvent((event) => {
          events.push(event)
          if (event.type === "protocol-error") resolve(event.message)
        }),
      )
      try {
        const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
        await host.startTurn({ cwd: fixture.root, threadId, submissionId: "hook-submission", text: "Hello" })
        assert.match(await failed, new RegExp(`hook/completed run.${field}`))
        assert.equal(
          events.some((event) => event.type === "hook-completed"),
          false,
        )
      } finally {
        await host.close()
      }
    })
  }

  it("uses the current main thread contract and projects one correlated turn", { timeout: 5000 }, async () => {
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
    assert.deepEqual(
      events.filter((event) => event.type === "hook-completed"),
      [
        {
          type: "hook-completed",
          threadId,
          turnId,
          eventName: "SessionStart",
          toolName: null,
          command: "check.sh",
          outcome: "allow",
          reason: null,
          elapsedMs: 12,
        },
        {
          type: "hook-completed",
          threadId,
          turnId,
          eventName: "PostToolUse",
          toolName: "run_bash",
          command: "check.sh",
          outcome: "allow",
          reason: "ok",
          elapsedMs: 12,
        },
      ],
    )
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
      name: null,
      id: "thread-1",
      cwd: fixture.root,
      archived: false,
      model: "codem/auto",
      profile: "default",
      startedAt: "2026-09-15T00:00:00.000Z",
      status: "idle",
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
    const launch = captured[0]
    assert.ok(launch, "Core launch must be captured")
    assert.deepEqual(launch.argv, ["app-server"])
    assert.deepEqual((launch.environment as Record<string, unknown>).credentialHost, [
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

  it("coalesces mode reads, uses broadcasts until conflict, and reads again after retirement", async () => {
    const fixture = createFixture()
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "mode-cache", version: "1" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath, DELAY_MODE_READ: "1" },
      assertAuthenticated: () => {},
    })
    const reads = () =>
      readFileSync(fixture.capturePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.method === "thread/mode/read").length
    try {
      const id = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      await Promise.all([host.readModes(fixture.root, id), host.readModes(fixture.root, id)])
      await host.readModes(fixture.root, id)
      assert.equal(reads(), 1)
      await host.setModes({ cwd: fixture.root, threadId: id, expectedRevision: 0, permissionMode: "yolo" })
      assert.equal((await host.readModes(fixture.root, id)).permissionMode, "yolo")
      assert.equal(reads(), 1)
      await assert.rejects(
        host.setModes({ cwd: fixture.root, threadId: id, expectedRevision: 0, permissionMode: "auto" }),
        /revision conflict/,
      )
      assert.equal((await host.readModes(fixture.root, id)).permissionMode, "yolo")
      assert.equal(reads(), 2)
      await host.unsubscribeThread(fixture.root, id)
      await host.resumeThread(fixture.root, id, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      assert.equal((await host.readModes(fixture.root, id)).permissionMode, "yolo")
      assert.equal(reads(), 3)
    } finally {
      await host.close()
    }
  })

  it("clears a rejected mode read so retry can succeed", async () => {
    const fixture = createFixture()
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "mode-retry", version: "1" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath, FAIL_FIRST_MODE_READ: "1" },
      assertAuthenticated: () => {},
    })
    try {
      const id = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      await assert.rejects(host.readModes(fixture.root, id), /mode read failed/)
      assert.equal((await host.readModes(fixture.root, id)).permissionMode, "default")
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
      codem_managed_dir: "/untrusted",
      CODEM_PROJECT_LIST: "/untrusted/list",
      CODEM_HOST_CHANNEL_CMD: "untrusted",
    })
    assert.equal(environment.codem_router_credential_host_cmd, undefined)
    assert.deepEqual(JSON.parse(environment.CODEM_ROUTER_CREDENTIAL_HOST_CMD!), ["/bin/true", "__host-serve"])
    assert.equal(environment.CODEM_SESSION_SOURCE, "vscode")
    assert.equal(environment.codem_managed_dir, undefined)
    assert.equal(environment.CODEM_PROJECT_LIST, undefined)
    assert.equal(environment.CODEM_MANAGED_DIR, "")
    assert.deepEqual(JSON.parse(environment.CODEM_HOST_CHANNEL_CMD!), ["/bin/true", "__host-serve"])
  })

  it("launches Core in the prepared space and refuses a failed preparation", async () => {
    const fixture = createFixture()
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "space-test", version: "1" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath },
      assertAuthenticated: () => {},
      prepareSpace: async () => ({ projectKey: "proj_test", displayName: "Test", managedDirectory: fixture.root }),
    })
    try {
      await host.prepareConnection(fixture.root)
      const capture = JSON.parse(readFileSync(fixture.capturePath, "utf8").split("\n")[0])
      assert.deepEqual(capture.argv, ["--project-key", "proj_test", "app-server"])
      assert.equal(capture.environment.managedDirectory, fixture.root)
    } finally {
      await host.close()
    }
    const rejected = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "space-test", version: "1" },
      assertAuthenticated: () => {},
      prepareSpace: async () => {
        throw new Error("space access denied")
      },
    })
    try {
      await assert.rejects(rejected.prepareConnection(fixture.root), /space access denied/)
    } finally {
      await rejected.close()
    }
  })

  it("exposes Core control-plane and thread extension RPCs as typed host methods", { timeout: 5000 }, async () => {
    const fixture = createFixture()
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "control-plane", version: "1" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath, HAS_TERMINAL: "1" },
      assertAuthenticated: () => {},
    })
    const events: AppServerHostEvent[] = []
    host.onEvent((event) => events.push(event))
    try {
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      assert.equal((await host.readEnvironmentInfo(fixture.root)).os, "macos")
      const config = await host.readConfigSnapshot(fixture.root)
      assert.equal(config.writable, false)
      assert.equal((config.config.custom as { apikey: null }[])[0].apikey, null)
      assert.equal((await host.listHooks(fixture.root)).hooks.SessionStart?.[0]?.command, "check.sh")
      assert.equal((await host.listPlugins(fixture.root)).installed.demo?.name, "demo")
      assert.deepEqual(
        (await host.listPermissionProfiles(fixture.root)).map((profile) => profile.id),
        ["default", "auto", "yolo"],
      )
      assert.deepEqual(await host.readCoreSpaceSnapshot(fixture.root), { current: null, spaces: [] })
      assert.equal((await host.readModelProviderCapabilities(fixture.root)).askUser.image_attachments_v1, true)
      assert.deepEqual(await host.listTools(fixture.root, threadId), {
        threadId,
        model: "codem-router/auto",
        tools: ["read_files", "run_bash"],
      })
      assert.deepEqual(await host.listLoadedThreadIds(fixture.root), { threadIds: ["thread-1"] })
      assert.deepEqual(await host.listLiveThreadTurns(fixture.root, threadId), {
        entries: [],
        nextCursor: null,
        total: 0,
      })
      assert.deepEqual(await host.listLiveThreadItems(fixture.root, threadId), {
        entries: [],
        nextCursor: null,
        total: 0,
      })
      const terminals = await host.listBackgroundTerminals(fixture.root, threadId)
      assert.equal(terminals.terminals[0]?.processId, 4242)
      await host.terminateBackgroundTerminal(fixture.root, threadId, 4242)
      await assert.rejects(host.terminateBackgroundTerminal(fixture.root, threadId, 99), /not on thread/)
      assert.deepEqual(await host.cleanBackgroundTerminals(fixture.root, threadId), {
        cwd: fixture.root,
        results: [],
      })
      await host.runShellCommand(fixture.root, threadId, "echo hi")
      const clearedId = await host.clearThread(fixture.root, threadId, "op-clear-1")
      assert.equal(clearedId, "cleared-thread")
      await assert.rejects(host.readModes(fixture.root, threadId), /not loaded/)
      await host.listTools(fixture.root, clearedId)
      assert.equal(events.some((event) => event.type === "thread-cleared" && event.threadId === threadId), true)
      const captured = readFileSync(fixture.capturePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> })
      const clear = captured.find((entry) => entry.method === "thread/clear")
      assert.deepEqual(clear?.params?.model, { id: "codem-router/auto", intelligence: "medium" })
      assert.equal(clear?.params?.executionMode, "default")
      assert.equal(clear?.params?.operationId, "op-clear-1")
    } finally {
      await host.close()
    }
  })

  it("projects commandExecution approval when Core omits option labels", { timeout: 5000 }, async () => {
    const fixture = createFixture()
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "hitl-label", version: "1" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath, HITL_EMPTY_LABEL: "1" },
      assertAuthenticated: () => {},
    })
    const events: AppServerHostEvent[] = []
    let sawCompleted!: () => void
    const seen = new Promise<void>((resolve, reject) => {
      host.onEvent((event) => {
        events.push(event)
        if (event.type === "interaction") resolve()
        if (event.type === "turn-completed") sawCompleted()
        if (event.type === "protocol-error") reject(new Error(event.message))
      })
    })
    const completed = new Promise<void>((resolve) => {
      sawCompleted = resolve
    })
    void seen.catch(() => {})
    try {
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      await host.startTurn({ cwd: fixture.root, threadId, submissionId: "hitl", text: "echo" })
      await seen
      const interaction = events.find((event) => event.type === "interaction")
      assert.ok(interaction?.type === "interaction" && interaction.interaction.kind === "permission")
      assert.deepEqual(
        interaction.interaction.options.map((option) => option.id),
        ["allow_once", "reject_once"],
      )
      assert.deepEqual(
        interaction.interaction.options.map((option) => option.label),
        ["allow_once", "Reject"],
      )
      await host.respondToInteraction(interaction.interaction.requestId, {
        kind: "permission",
        optionId: "allow_once",
      })
      await completed
      assert.equal(
        events.some((event) => event.type === "protocol-error" || event.type === "connection-closed"),
        false,
      )
      assert.equal(
        events.filter((event) => event.type === "connection-ready").length,
        1,
      )
    } finally {
      await host.close()
    }
  })

  it("fails closed on an unknown Core notification", { timeout: 5000 }, async () => {
    const fixture = createFixture()
    const host = new AppServerHost({
      runtime: fixture.runtime,
      clientInfo: { name: "unknown-note", version: "1" },
      environment: { PATH: process.env.PATH, CAPTURE_PATH: fixture.capturePath, UNKNOWN_NOTIFICATION: "1" },
      assertAuthenticated: () => {},
    })
    const failed = new Promise<string>((resolve) =>
      host.onEvent((event) => {
        if (event.type === "protocol-error") resolve(event.message)
      }),
    )
    try {
      const threadId = await host.startThread(fixture.root, DEFAULT_APP_SERVER_THREAD_SETTINGS)
      await host.startTurn({ cwd: fixture.root, threadId, submissionId: "unknown", text: "Hello" })
      assert.match(await failed, /unknown notification future\/unknown/)
    } finally {
      await host.close()
    }
  })
})

function createFixture(
  hookRun: Record<string, unknown> = {
    event: "SessionStart",
    tool: "",
    command: "check.sh",
    outcome: "allow",
    reason: null,
    elapsedMs: 12,
  },
  textNotifications: readonly { method: string; params: Record<string, unknown> }[] = [
    { method: "item/agentMessage/delta", params: { delta: "Done" } },
  ],
): { readonly root: string; readonly capturePath: string; readonly runtime: AppServerRuntime } {
  const root = mkdtempSync(join(tmpdir(), "codem-host-"))
  temporaryDirectories.push(root)
  const executablePath = join(root, "codem-core")
  const capturePath = join(root, "capture.jsonl")
  writeFileSync(executablePath, fixtureSource(completeCapabilities(), hookRun, textNotifications))
  chmodSync(executablePath, 0o755)
  return {
    root,
    capturePath,
    runtime: {
      target: "darwin-arm64",
      packageName: "@lark-codem/codem-core-darwin-arm64",
      coreVersion: "0.8.44",
      executablePath,
      licensePath: join(root, "LICENSE.core"),
      authPackageName: "@lark-codem/codem-cli-darwin-arm64",
      cliVersion: "0.1.208",
      authExecutablePath: "/bin/true",
      authLicensePath: join(root, "LICENSE.auth"),
    },
  }
}

function fixtureSource(
  capabilities: Record<string, unknown>,
  hookRun: Record<string, unknown>,
  textNotifications: readonly { method: string; params: Record<string, unknown> }[],
): string {
  return `#!/usr/bin/env node
const fs = require("node:fs")
const readline = require("node:readline")
const capture = (value) => fs.appendFileSync(process.env.CAPTURE_PATH, JSON.stringify(value) + "\\n")
capture({ pid: process.pid, argv: process.argv.slice(2), environment: { credentialHost: JSON.parse(process.env.CODEM_ROUTER_CREDENTIAL_HOST_CMD), source: process.env.CODEM_SESSION_SOURCE, managedDirectory: process.env.CODEM_MANAGED_DIR } })
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n")
const modes = new Map()
let failedModeRead = false
let hitlThread = null
const mode = (threadId) => modes.get(threadId) ?? { revision: 0, permissionEpoch: 0, permissionMode: "default", workMode: "normal" }
const lines = readline.createInterface({ input: process.stdin })
if (process.env.IGNORE_SHUTDOWN) {
  setInterval(() => {}, 1000)
  process.on("SIGTERM", () => capture({ signal: "SIGTERM" }))
}
lines.on("close", () => { capture({ stdinClosed: true }); if (!process.env.IGNORE_SHUTDOWN) process.exit(0) })
lines.on("line", (line) => {
  const frame = JSON.parse(line)
  if (!Object.prototype.hasOwnProperty.call(frame, "id")) return
  if (typeof frame.method !== "string") {
    if (hitlThread && frame.id === "hitl-1") {
      send({ jsonrpc: "2.0", method: "item/completed", params: { threadId: hitlThread, turnId: "turn-1", item: { id: "tool-1", type: "commandExecution", status: "completed", callId: "call-1", summary: "exit 0", output: "HITL_OK", isError: false } } })
      send({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: hitlThread, turn: { id: "turn-1", status: "completed", stopReason: "end_turn", error: null } } })
    }
    return
  }
  capture({ method: frame.method, params: frame.params })
  if (frame.method === process.env.SHUTDOWN_HANG) return
  if (frame.method === "initialize") return send({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: 1, agentInfo: { version: "0.8.44+1.gfixture" }, capabilities: ${JSON.stringify(capabilities)} } })
  if (frame.method === "thread/start") return send({ jsonrpc: "2.0", id: frame.id, result: { thread: { id: "thread-1" } } })
  if (frame.method === "thread/resume") return send({ jsonrpc: "2.0", id: frame.id, result: { thread: { id: frame.params.threadId } } })
  if (frame.method === "thread/sideQuestion/start") {
    const sideQuestion = { id: "question-1", question: frame.params.question, status: "inProgress" }
    send({ method: "thread/sideQuestion/started", params: { threadId: frame.params.threadId, sideQuestion } })
    send({ id: frame.id, result: { sideQuestion: { ...sideQuestion, status: "accepted" } } })
    if (process.env.SHUTDOWN_HOLD === "question") return
    for (const notification of ${JSON.stringify(textNotifications)}) send({ method: notification.method, params: { threadId: frame.params.threadId, sideQuestionId: sideQuestion.id, ...notification.params } })
    return send({ method: "thread/sideQuestion/completed", params: { threadId: frame.params.threadId, sideQuestion: { ...sideQuestion, status: "completed" } } })
  }
  if (frame.method === "thread/unsubscribe") return send({ id: frame.id, result: process.env.OLD_UNSUBSCRIBE_RESULT ? {} : { status: "unsubscribed" } })
  if (frame.method === "thread/mode/read") {
    if (process.env.FAIL_FIRST_MODE_READ && !failedModeRead) {
      failedModeRead = true
      return send({ id: frame.id, error: { code: -32000, message: "mode read failed" } })
    }
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
  if (frame.method === "environment/info") return send({ id: frame.id, result: { agent: { name: "codem", version: "0.8.44+1.gfixture" }, arch: "aarch64", cwd: require("node:path").dirname(process.env.CAPTURE_PATH), os: "macos", shell: "/bin/zsh" } })
  if (frame.method === "config/read") return send({ id: frame.id, result: { writable: false, writeOwner: "codem-bridge", config: { active: { model: "codem-router/auto" }, custom: [{ apikey: "secret-value", model: "codem-router/auto" }] } } })
  if (frame.method === "hooks/list") return send({ id: frame.id, result: { cwd: require("node:path").dirname(process.env.CAPTURE_PATH), hooks: { SessionStart: [{ command: "check.sh", matcher: null }] } } })
  if (frame.method === "plugin/list") return send({ id: frame.id, result: { installed: { demo: { name: "demo", enabled: true } }, marketplaces: {} } })
  if (frame.method === "permissionProfile/list") return send({ id: frame.id, result: { profiles: [{ id: "default", name: "Ask", description: "Ask", settableAtRuntime: true }, { id: "auto", name: "Auto", description: "Review", settableAtRuntime: true }, { id: "yolo", name: "Yolo", description: "Bypass", settableAtRuntime: true }] } })
  if (frame.method === "space/list") return send({ id: frame.id, result: { current: null, spaces: [] } })
  if (frame.method === "modelProvider/capabilities/read") return send({ id: frame.id, result: { version: "0.8.44+1.gfixture", ask_user: { image_attachments_v1: true }, custom: { auth_mode: true } } })
  if (frame.method === "tools/list") return send({ id: frame.id, result: { threadId: frame.params.threadId, model: "codem-router/auto", tools: ["read_files", "run_bash"] } })
  if (frame.method === "thread/loaded/list") return send({ id: frame.id, result: { threadIds: ["thread-1"] } })
  if (frame.method === "thread/backgroundTerminals/list") return send({ id: frame.id, result: { cwd: require("node:path").dirname(process.env.CAPTURE_PATH), terminals: process.env.HAS_TERMINAL ? [{ processId: 4242, logPath: "/tmp/codem-term.log", alive: true }] : [] } })
  if (frame.method === "thread/backgroundTerminals/terminate") return send({ id: frame.id, result: {} })
  if (frame.method === "thread/backgroundTerminals/clean") return send({ id: frame.id, result: { cwd: require("node:path").dirname(process.env.CAPTURE_PATH), results: [] } })
  if (frame.method === "thread/shellCommand") return send({ id: frame.id, result: {} })
  if (frame.method === "thread/clear") {
    send({ method: "thread/cleared", params: { threadId: frame.params.threadId } })
    const invalid = process.env.INVALID_CLEAR
    return send({ id: frame.id, result: { operationId: invalid === "operation" ? "wrong" : frame.params.operationId, previousThreadId: invalid === "source" ? "wrong" : frame.params.threadId, thread: { id: invalid === "same-id" ? frame.params.threadId : "cleared-thread", cwd: invalid === "cwd" ? "/foreign" : frame.params.cwd, status: invalid === "status" ? "idle" : "loaded" } } })
  }
  if (frame.method === "thread/turns/list") return send({ id: frame.id, result: { turns: [], nextCursor: null, total: 0 } })
  if (frame.method === "thread/items/list") return send({ id: frame.id, result: { items: [], nextCursor: null, total: 0 } })
  if (frame.method === "turn/start") {
    send({ jsonrpc: "2.0", method: "turn/started", params: { threadId: frame.params.threadId, turn: { id: "turn-1" } } })
    send({ jsonrpc: "2.0", id: frame.id, result: { turn: { id: "turn-1" } } })
    send({ jsonrpc: "2.0", method: "item/started", params: { threadId: frame.params.threadId, turnId: "turn-1", item: { id: "tool-1", type: "commandExecution", status: "inProgress", tool: "run_bash", callId: "call-1", arguments: { command: "pwd" } } } })
    if (process.env.SHUTDOWN_HOLD === "turn") return
    if (process.env.HITL_EMPTY_LABEL) {
      hitlThread = frame.params.threadId
      send({ jsonrpc: "2.0", id: "hitl-1", method: "item/commandExecution/requestApproval", params: { threadId: frame.params.threadId, turnId: "turn-1", requestId: "permission-1", tool: "run_bash", callId: "call-1", options: [{ optionId: "allow_once", label: "" }, { optionId: "reject_once", name: "Reject" }], preview: { kind: "bash_command", cwd: require("node:path").dirname(process.env.CAPTURE_PATH), command: "echo HITL_OK", risk: {}, suggestedRules: [] } } })
      return
    }
    send({ jsonrpc: "2.0", method: "item/commandExecution/outputDelta", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "tool-1", delta: "running pwd" } })
    send({ jsonrpc: "2.0", method: "item/toolCall/guardUpdated", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "tool-1", callId: "call-1", guard: { tool: "run_bash", status: "pass", reason: "ok", rawResultBytes: null, returnedResultBytes: 11, formattedCapBytes: null, globalBackstopApplied: false, suggestion: null } } })
    const diff = JSON.stringify({ tool_call_id: "call-1", path: "src/example.ts", change_type: "modified", is_binary: false, truncated: false, stats: { lines_added: 1, lines_removed: 0 }, hunks: [{ old_start: 1, old_count: 1, new_start: 1, new_count: 2, lines: [{ kind: "context", old_line: 1, new_line: 1, text: "const before = true" }, { kind: "insert", old_line: null, new_line: 2, text: "const after = true" }] }], raw_unified: null })
    const split = Math.floor(diff.length / 2)
    send({ jsonrpc: "2.0", method: "item/fileChange/delta", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "diff-1", callId: "call-1", sequence: 0, delta: diff.slice(0, split), encoding: "json", complete: false } })
    send({ jsonrpc: "2.0", method: "item/fileChange/delta", params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "diff-1", callId: "call-1", sequence: 1, delta: diff.slice(split), encoding: "json", complete: true } })
    send({ jsonrpc: "2.0", method: "item/completed", params: { threadId: frame.params.threadId, turnId: "turn-1", item: { id: "tool-1", type: "commandExecution", status: "completed", callId: "call-1", summary: "exit 0", output: "/workspace", isError: false } } })
    send({ jsonrpc: "2.0", method: "hook/completed", params: { threadId: frame.params.threadId, turnId: "turn-1", run: ${JSON.stringify(hookRun)} } })
    send({ jsonrpc: "2.0", method: "hook/completed", params: { threadId: frame.params.threadId, turnId: "turn-1", run: { event: "PostToolUse", tool: "run_bash", command: "check.sh", outcome: "allow", reason: "ok", elapsedMs: 12 } } })
    send({ jsonrpc: "2.0", method: "backgroundTask/wakeQueued", params: { threadId: frame.params.threadId, turnId: "turn-1", taskId: "task-1" } })
    send({ jsonrpc: "2.0", method: "backgroundTask/wakeStarted", params: { threadId: frame.params.threadId, turnId: "turn-1", taskId: "task-1" } })
    send({ jsonrpc: "2.0", method: "backgroundTask/wakeSkipped", params: { threadId: frame.params.threadId, turnId: "turn-1", taskId: "task-2" } })
    send({ jsonrpc: "2.0", method: "turn/diff/updated", params: { threadId: frame.params.threadId, turnId: "turn-1", diff: [{ path: "src/example.ts", linesAdded: 1, linesRemoved: 0 }] } })
    send({ jsonrpc: "2.0", method: "item/started", params: { threadId: frame.params.threadId, turnId: "turn-1", item: { id: "item-1", type: "agentMessage", status: "inProgress" } } })
    if (process.env.UNKNOWN_NOTIFICATION) send({ jsonrpc: "2.0", method: "future/unknown", params: { threadId: frame.params.threadId, turnId: "turn-1" } })
    for (const notification of ${JSON.stringify(textNotifications)}) send({ jsonrpc: "2.0", method: notification.method, params: { threadId: frame.params.threadId, turnId: "turn-1", itemId: "item-1", ...notification.params } })
    send({ jsonrpc: "2.0", method: "item/completed", params: { threadId: frame.params.threadId, turnId: "turn-1", item: { id: "item-1", type: "agentMessage", status: "completed", text: "Done" } } })
    if (process.env.BACKGROUND_AFTER_TURN) setTimeout(() => {
      send({ method: "backgroundTask/wakeQueued", params: { threadId: frame.params.threadId, turnId: "turn-1", taskId: "idle-task" } })
      send({ method: "backgroundTask/wakeStarted", params: { threadId: frame.params.threadId, turnId: "turn-1", taskId: "idle-task" } })
      send({ method: "turn/started", params: { threadId: "foreign-thread", turn: { id: "foreign-turn" } } })
      send({ method: "turn/started", params: { threadId: frame.params.threadId, turn: { id: "wake-turn" } } })
      send({ method: "item/agentMessage/delta", params: { threadId: frame.params.threadId, turnId: "wake-turn", itemId: "wake-answer", delta: "Background finished" } })
      send({ method: "turn/completed", params: { threadId: frame.params.threadId, turn: { id: "wake-turn", status: "completed", stopReason: "end_turn", error: null } } })
      send({ method: "turn/started", params: { threadId: frame.params.threadId, turn: { id: "wake-turn" } } })
      send({ method: "item/agentMessage/delta", params: { threadId: frame.params.threadId, turnId: "wake-turn", itemId: "wake-answer", delta: "stale" } })
    }, 10)
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
