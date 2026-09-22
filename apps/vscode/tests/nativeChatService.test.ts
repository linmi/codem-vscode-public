import { fixturePluginCommands } from "./pluginFixtures.ts"
import assert from "node:assert/strict"
import { it } from "node:test"
import { setImmediate } from "node:timers/promises"
import type { AppServerHostEvent, AppServerInteractionResponse } from "@codem/app-server"
import type { ChatHost, ChatSession } from "../src/chat/chatController.ts"
import { NativeChatService, NativeChatProjection } from "../src/nativeChat/nativeChatService.ts"
import { nativeThreadId } from "../src/nativeChat/nativeChatApi.ts"
import { initialSnapshot } from "../src/shared/messages.ts"
import { capabilityHostFixture } from "./capabilityHostFixture.ts"
import { fixtureSpaceDirectory } from "./spaceFixtures.ts"

const signal = () => new AbortController().signal
function setup() {
  let listener: (event: AppServerHostEvent) => void = () => {}
  let connects = 0, starts = 0, turns = 0, stops = 0, closes = 0
  let trusted = true
  const answers: AppServerInteractionResponse[] = []
  const host: ChatHost = {
    ...capabilityHostFixture(),
    onEvent(callback) { listener = callback; return () => { listener = () => {} } },
    async listThreads() { return { threads: [{ id: "old", cwd: "/workspace", archived: false, model: "model", profile: "default", preview: "history", startedAt: "2026-09-20T00:00:00Z", turnCount: 0 }], nextCursor: null, total: 1 } },
    async readThread(_cwd, id) { return { id, cwd: "/workspace", archived: false, model: "model", profile: "default", name: "old", startedAt: "2026-09-20T00:00:00Z", status: "idle" } },
    async resumeThread() {}, async unsubscribeThread() {},
    async readModes() { return { revision: 1, permissionEpoch: 1, permissionMode: "default", workMode: "normal" } },
    async setModes() { throw new Error("unexpected mode change") },
    async listTools() { return { threadId: "thread-1", model: "model", tools: [] } },
    async listBackgroundTerminals() { return { cwd: "/workspace", terminals: [] } },
    async terminateBackgroundTerminal() {}, async cleanBackgroundTerminals() { return { cwd: "/workspace", results: [] } }, async cancelBackgroundTask() { return "cancelled" },
    async startThread(_cwd, settings) { assert.equal(settings.permissionMode, "default"); return `thread-${++starts}` },
    async startTurn(input) { const turnId = `turn-${++turns}`; listener({ type: "turn-started", threadId: input.threadId, turnId, submissionId: input.submissionId }); return turnId },
    async interruptTurn() { stops++ },
    async respondToInteraction(_id, response) { answers.push(response) },
    async close() { closes++ },
  }
  const session: ChatSession = { host, cwd: "/workspace", workspace: "project", space: { key: "testSpace", name: "Test" }, spaceDirectory: fixtureSpaceDirectory(), model: "model", models: [{ id: "model", source: "fixture", supportsVision: false, contextWindowTokens: 10000 }], mcpServers: [], authorize: async () => {}, pluginCommands: fixturePluginCommands(), searchHistory: async () => ({ hits: [], truncated: false }), readHistory: async () => ({ todoSnapshot: null, turns: [], nextCursor: null }) }
  let interact: (request: unknown, signal: AbortSignal) => Promise<AppServerInteractionResponse | null> = async () => null
  const service = new NativeChatService({ connect: async () => { connects++; return session }, assertTrusted() { assert.ok(trusted, "workspace trust") }, interact: (r, s) => interact(r, s), report() {} }, () => {}, 25)
  let text = ""
  const progress: string[] = []
  const output = { text(value: string) { text += value }, progress(value: string) { progress.push(value) } }
  const emit = (event: AppServerHostEvent) => listener(event)
  const complete = (threadId = "thread-1", turnId = `turn-${turns}`, outcome: "completed" | "stopped" | "failed" = "completed") => emit({ type: "turn-completed", threadId, turnId, outcome, stopReason: "test", error: null })
  return { service, host, session, emit, complete, output, text: () => text, counts: () => ({ connects, starts, turns, stops, closes }), answers, untrust: () => { trusted = false }, interact: (fn: typeof interact) => { interact = fn } }
}

it("native session creation and repeated prompts share one Core connection and identity", async () => {
  const f = setup()
  try {
    assert.equal(f.counts().connects, 0)
    const id = await f.service.create(signal())
    assert.equal(id, "thread-1")
    for (let i = 1; i <= 2; i++) {
      const run = f.service.run(id, `prompt ${i}`, f.output, signal())
      await setImmediate()
      f.emit({ type: "text-delta", threadId: id, turnId: `turn-${i}`, itemId: "reply", delta: `answer${i}` })
      f.complete(); await run
    }
    assert.equal(f.text(), "answer1answer2")
    assert.deepEqual(f.counts(), { connects: 1, starts: 1, turns: 2, stops: 0, closes: 0 })
  } finally { await f.service.dispose() }
})

it("a cancelled request waits for Core terminal; repeated requests and session switches are rejected", async () => {
  const f = setup(), abort = new AbortController()
  try {
    const id = await f.service.create(signal())
    const run = f.service.run(id, "task", f.output, abort.signal)
    await setImmediate(); abort.abort(); await setImmediate()
    assert.equal(f.counts().stops, 1)
    assert.equal(f.service.snapshot().phase, "stopping")
    await assert.rejects(f.service.run(id, "duplicate", f.output, signal()), /正在处理/)
    await assert.rejects(f.service.history("old", signal()), /正在处理/)
    await assert.rejects(f.service.create(signal()), /正在处理/)
    f.complete(id, "turn-1", "stopped"); await run
    assert.equal(f.service.snapshot().phase, "ready")
  } finally { await f.service.dispose() }
})

it("cancellation during a delayed start receipt interrupts once after the correlated start", async () => {
  const f = setup(), abort = new AbortController()
  let started!: () => void
  f.host.startTurn = input => new Promise(resolve => { started = () => { f.emit({ type: "turn-started", threadId: input.threadId, turnId: "delayed", submissionId: input.submissionId }); resolve("delayed") } })
  try {
    const id = await f.service.create(signal())
    const run = f.service.run(id, "task", f.output, abort.signal)
    await setImmediate(); abort.abort(); started(); await setImmediate()
    assert.equal(f.counts().stops, 1)
    f.complete(id, "delayed", "stopped"); await run
  } finally { await f.service.dispose() }
})

it("missing cancellation terminal closes the Core connection and permits explicit reconnect", async () => {
  const f = setup(), abort = new AbortController()
  try {
    const id = await f.service.create(signal())
    const run = f.service.run(id, "task", f.output, abort.signal)
    await setImmediate(); abort.abort()
    await assert.rejects(run, /未收到 Core 终态/)
    assert.equal(f.counts().closes, 1)
    assert.equal(f.service.snapshot().phase, "disconnected")
    await f.service.connect(signal())
    assert.equal(f.counts().connects, 2)
  } finally { await f.service.dispose() }
})

it("terminal before start receipt is honored and foreign/late deltas cannot leak into native output", async () => {
  const f = setup()
  f.host.startTurn = async input => {
    f.emit({ type: "turn-started", threadId: input.threadId, turnId: "fast", submissionId: input.submissionId })
    f.emit({ type: "text-delta", threadId: "foreign", turnId: "fast", itemId: "a", delta: "secret" })
    f.emit({ type: "text-delta", threadId: input.threadId, turnId: "fast", itemId: "a", delta: "ok" })
    f.complete(input.threadId, "fast")
    f.emit({ type: "text-delta", threadId: input.threadId, turnId: "fast", itemId: "a", delta: "late" })
    return "fast"
  }
  try { const id = await f.service.create(signal()); await f.service.run(id, "task", f.output, signal()); assert.equal(f.text(), "ok") }
  finally { await f.service.dispose() }
})

it("cancellation deadline also releases a request whose start RPC never returns", async () => {
  const f = setup(), abort = new AbortController()
  f.host.startTurn = () => new Promise(() => {})
  try {
    const id = await f.service.create(signal())
    const run = f.service.run(id, "task", f.output, abort.signal)
    await setImmediate(); abort.abort()
    await assert.rejects(run, /未收到 Core 终态/)
    assert.equal(f.counts().closes, 1)
    assert.equal(f.service.snapshot().phase, "disconnected")
  } finally { await f.service.dispose() }
})

it("a failed thread creation is visible and can be retried without reconnecting", async () => {
  const f = setup()
  const start = f.host.startThread
  f.host.startThread = async () => { throw new Error("fixture start failed") }
  try {
    await assert.rejects(f.service.create(signal()), /fixture start failed/)
    assert.equal(f.service.snapshot().phase, "ready")
    assert.equal(f.service.snapshot().threadId, null)
    f.host.startThread = start
    assert.equal(await f.service.create(signal()), "thread-1")
    assert.equal(f.counts().connects, 1)
  } finally { await f.service.dispose() }
})

it("native history is restored only from listed workspace threads; unknown IDs never start turns", async () => {
  const f = setup()
  try {
    assert.deepEqual(await f.service.history("old", signal()), [])
    assert.equal(f.service.snapshot().threadId, "old")
    await assert.rejects(f.service.history("../foreign", signal()), /请选择/)
    assert.equal(f.counts().turns, 0)
  } finally { await f.service.dispose() }
})

it("failed Core turns and disconnections produce errors instead of successful native responses", async () => {
  const f = setup()
  try {
    const id = await f.service.create(signal())
    const run = f.service.run(id, "task", f.output, signal())
    await setImmediate(); f.complete(id, "turn-1", "failed")
    await assert.rejects(run, /失败/)
    const next = f.service.run(id, "again", f.output, signal())
    await setImmediate(); f.emit({ type: "connection-closed", cwd: "/workspace", exit: { code: 1, signal: null, expected: false } })
    await assert.rejects(next, /CORE_PROCESS_EXIT/)
  } finally { await f.service.dispose() }
})

it("expired approvals cannot respond after completion and disposal closes active requests", async () => {
  const f = setup()
  let resolve!: (answer: AppServerInteractionResponse) => void
  let approvalSignal!: AbortSignal
  f.interact((_request, signal) => { approvalSignal = signal; return new Promise(done => { resolve = done }) })
  try {
    const id = await f.service.create(signal())
    const run = f.service.run(id, "task", f.output, signal())
    await setImmediate()
    f.emit({ type: "interaction", interaction: { kind: "plan-mode", threadId: id, turnId: "turn-1", requestId: "approval" } })
    await setImmediate(); f.complete(); await run
    assert.equal(approvalSignal.aborted, true)
    resolve({ kind: "plan-mode", approved: true }); await setImmediate()
    assert.equal(f.answers.length, 0)
    const next = f.service.run(id, "task", f.output, signal())
    const rejected = assert.rejects(next, /已关闭/)
    await setImmediate(); await f.service.dispose(); await rejected
    assert.equal(f.counts().closes, 1)
  } finally { await f.service.dispose() }
})

it("trust and already-cancelled requests prevent startup", async () => {
  const f = setup(), abort = new AbortController()
  try {
    abort.abort(); await assert.rejects(f.service.create(abort.signal))
    f.untrust(); await assert.rejects(f.service.create(signal()))
    assert.equal(f.counts().connects, 0)
  } finally { await f.service.dispose() }
})

it("repeated disposal awaits the same Core shutdown", async () => {
  const f = setup()
  let close!: () => void
  f.host.close = () => new Promise(resolve => { close = resolve })
  await f.service.connect(signal())
  const first = f.service.dispose()
  const second = f.service.dispose()
  assert.equal(first, second)
  let settled = false
  void second.then(() => { settled = true })
  await setImmediate()
  assert.equal(settled, false)
  close()
  await second
  assert.equal(settled, true)
})

it("native resources reject traversal, foreign schemes, drafts and query payloads", () => {
  const base = { scheme: "codem-native", authority: "", path: "/thread-1", query: "", fragment: "" }
  assert.equal(nativeThreadId(base), "thread-1")
  for (const patch of [{ path: "/../thread" }, { path: "/untitled-123" }, { scheme: "file" }, { authority: "remote" }, { query: "path=/secret" }, { fragment: "a" }]) assert.throws(() => nativeThreadId({ ...base, ...patch }))
})

it("snapshot projection emits only new text and does not duplicate completed snapshots", () => {
  let text = ""
  const p = new NativeChatProjection([], { text: s => { text += s }, progress() {} })
  const state = initialSnapshot()
  state.messages = [{ id: "a", role: "assistant", label: "CodeM", text: "hello" }]
  p.update(state); p.update(state)
  state.messages[0]!.text += " world"; p.update(state)
  assert.equal(text, "hello world")
})

it("native projection reports a stopped turn once without replaying it in the next request", async () => {
  const { stoppedTurnMessage } = await import("../src/shared/turnStatus.ts")
  const progress: string[] = []
  const output = { text() {}, progress(value: string) { progress.push(value) } }
  const state = initialSnapshot()
  const projection = new NativeChatProjection([], output)
  state.messages = [stoppedTurnMessage("turn-stopped")]
  projection.update(state); projection.update(state)
  new NativeChatProjection(state.messages, output).update(state)
  assert.deepEqual(progress, ["已停止生成。"])
})
