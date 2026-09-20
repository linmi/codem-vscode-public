import { capabilityHostFixture } from "./capabilityHostFixture.ts"
import { fixtureSpaceDirectory } from "./spaceFixtures.ts"
import { ConnectionPreferences } from "../src/connectionPreferences.ts"
import { createHash } from "node:crypto"
import { createSessionHistoryReader } from "../src/sessionHistory.ts"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { it } from "node:test"
import type { AppServerHostEvent, AppServerInteractionResponse } from "@codem/app-server"
import { parseAppServerItem } from "@codem/app-server"
import { ChatController, UserVisibleError, type ChatHost, type ChatSession } from "../src/chatController.ts"

function setup() {
  let listener: (event: AppServerHostEvent) => void = () => undefined
  let submissionId = ""
  let connections = 0
  let starts = 0
  let turns = 0
  let closed = 0
  const answers: AppServerInteractionResponse[] = []
  const host: ChatHost = {
    ...capabilityHostFixture(),
    async listThreads() { return { threads: [], nextCursor: null, total: 0 } },
    async readThread() { throw new Error("No fixture history") },
    async resumeThread() {},
    async readModes() { return { revision: 1, permissionEpoch: 1, permissionMode: "default", workMode: "normal" } },
    async setModes(input) { return { revision: 2, permissionEpoch: 2, permissionMode: input.permissionMode ?? "default", workMode: input.workMode ?? "normal" } },
    async listTools() { return { threadId: "thread-1", model: "model-from-core", tools: ["read_files", "mcp__fixture__echo"] } },
    async listBackgroundTerminals() { return { cwd: "/workspace", terminals: [] } },
    async terminateBackgroundTerminal() {}, async cleanBackgroundTerminals() { return { cwd: "/workspace", results: [] } },
    async cancelBackgroundTask() { return "cancelled" },
    onEvent(callback) { listener = callback; return () => { listener = () => undefined } },
    async startThread(_cwd, settings) { starts++; assert.equal(settings.permissionMode, "default"); assert.equal(settings.model, "model-from-core"); return "thread-1" },
    async startTurn(input) {
      turns++; submissionId = input.submissionId
      listener({ type: "turn-started", threadId: "thread-1", turnId: `turn-${turns}`, submissionId })
      return `turn-${turns}`
    },
    async interruptTurn() {}, async unsubscribeThread() {},
    async respondToInteraction(_id, response) { answers.push(response) },
    async close() { closed++ },
  }
  const session: ChatSession = { authorize: async () => {}, readHistory: async () => ({ turns: [], nextCursor: null }), host, cwd: "/workspace", workspace: "project", space: { key: "testSpace", name: "测试空间" }, spaceDirectory: fixtureSpaceDirectory(), model: "model-from-core", models: [{ id: "model-from-core", source: "fixture", contextWindowTokens: 10000, supportsVision: true }, { id: "other-model", source: "fixture", contextWindowTokens: 20000, supportsVision: false }], mcpServers: [] }
  const controller = new ChatController({ connect: async () => { connections++; return session }, assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  return { controller, host, session, answers, emit: (event: AppServerHostEvent) => listener(event), counts: () => ({ connections, starts, turns, closed }), submission: () => submissionId }
}

it("connects only on the first valid send; denies simultaneous sends and keeps whitespace", async () => {
  const fixture = setup()
  assert.equal(fixture.controller.snapshot().phase, "disconnected")
  await fixture.controller.send("   ")
  await fixture.controller.send("x".repeat(32_001))
  assert.equal(fixture.counts().connections, 0)
  await Promise.all([fixture.controller.send("first"), fixture.controller.send("duplicate")])
  assert.equal(fixture.counts().turns, 1)
  assert.equal(fixture.counts().connections, 1)
  fixture.emit({ type: "text-delta", threadId: "thread-1", turnId: "turn-1", itemId: "answer", delta: " hello\n " })
  assert.equal(fixture.controller.snapshot().messages[1]?.text, " hello\n ")
  await fixture.controller.dispose()
  assert.equal(fixture.counts().closed, 1)
})

it("rejects cross-thread, wrong-submission and retired-turn events", async () => {
  const fixture = setup()
  await fixture.controller.connect(); await fixture.controller.send("hello")
  fixture.emit({ type: "turn-started", threadId: "thread-1", turnId: "rogue", submissionId: "not-ours" })
  for (const [threadId, turnId] of [["other", "turn-1"], ["thread-1", "rogue"]]) {
    fixture.emit({ type: "text-delta", threadId: threadId!, turnId: turnId!, itemId: "answer", delta: "wrong" })
  }
  assert.equal(fixture.controller.snapshot().messages.length, 1)
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
  fixture.emit({ type: "text-delta", threadId: "thread-1", turnId: "turn-1", itemId: "answer", delta: "late" })
  assert.equal(fixture.controller.snapshot().messages.length, 1)
  await fixture.controller.dispose()
})

it("a stop acknowledgement does not end the run; Core completion does", async () => {
  const fixture = setup()
  await fixture.controller.connect(); await fixture.controller.send("hello"); await fixture.controller.stop()
  assert.equal(fixture.controller.snapshot().phase, "stopping")
  await fixture.controller.newChat()
  assert.equal(fixture.controller.snapshot().messages.length, 1)
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "stopped", stopReason: "interrupt", error: null })
  assert.equal(fixture.controller.snapshot().phase, "ready")
  await fixture.controller.newChat()
  assert.deepEqual(fixture.controller.snapshot().messages, [])
  await fixture.controller.dispose()
})

it("does not resurrect a turn completed before startTurn resolves", async () => {
  const fixture = setup()
  fixture.host.startTurn = async (input) => {
    fixture.emit({ type: "turn-started", threadId: "thread-1", turnId: "turn-fast", submissionId: input.submissionId })
    fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-fast", outcome: "completed", stopReason: "end", error: null })
    return "turn-fast"
  }
  await fixture.controller.connect(); await fixture.controller.send("hello")
  assert.equal(fixture.controller.snapshot().phase, "ready")
  assert.equal(fixture.controller.snapshot().turnTimings.length, 1)
  assert.notEqual(fixture.controller.snapshot().turnTimings[0]!.finishedAt, null)
  await fixture.controller.dispose()
})

it("untrusted workspaces cannot reach the runtime factory", async () => {
  let connected = false
  const controller = new ChatController({
    assertTrusted() { throw new UserVisibleError("workspace is untrusted") },
    async connect() { connected = true; throw new Error("must not run") },
    publish() {}, interact: async () => null, report() {},
  })
  await controller.connect()
  assert.equal(connected, false)
  assert.equal(controller.snapshot().notice, "workspace is untrusted")
  await controller.dispose()
})

it("a late connection is closed after disposal", async () => {
  const fixture = setup()
  let resolve: (session: ChatSession) => void = () => undefined
  const controller = new ChatController({ connect: () => new Promise((done) => { resolve = done }), assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  const connecting = controller.connect()
  await controller.dispose()
  resolve(fixture.session)
  await connecting
  assert.equal(fixture.counts().closed, 1)
})

it("stale native approval results cannot authorize a finished turn", async () => {
  const fixture = setup()
  let respond: (value: AppServerInteractionResponse) => void = () => undefined
  const controller = new ChatController({ connect: async () => fixture.session, assertTrusted() {}, publish() {}, interact: () => new Promise((done) => { respond = done }), report() {} })
  await controller.connect(); await controller.send("hello")
  fixture.emit({ type: "interaction", interaction: { kind: "plan-mode", requestId: "r1", threadId: "thread-1", turnId: "turn-1" } })
  await new Promise((done) => setImmediate(done))
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "stopped", stopReason: "interrupt", error: null })
  respond({ kind: "plan-mode", approved: true })
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(fixture.answers, [])
  await controller.dispose()
})

it("preserves the tool list when a structured final answer follows the original reply", async () => {
  const fixture = setup()
  await fixture.controller.connect(); await fixture.controller.send("hello")
  const original = "可用工具：\n- read_files\n- run_bash\n- tool_search"
  fixture.emit({ type: "text-delta", threadId: "thread-1", turnId: "turn-1", itemId: "answer", delta: original })
  fixture.emit({ type: "item-completed", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem({ id: "final", type: "toolCall", tool: "final_answer", status: "completed", arguments: { status: "complete", kind: "chat", summary: "final reply", artifacts: [] } }, "fixture") })
  const answers = fixture.controller.snapshot().messages.filter((message) => message.role !== "user")
  assert.deepEqual(answers.map(message => message.text), [original, "final reply"])
  assert.notEqual(answers[0]!.id, answers[1]!.id)
  fixture.emit({ type: "item-completed", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem({ id: "answer", type: "agentMessage", status: "completed", text: original }, "fixture") })
  assert.deepEqual(fixture.controller.snapshot().messages.filter(message => message.role === "assistant").map(message => message.text), [original, "final reply"])
  await fixture.controller.dispose()
})

it("connection failure restores reconnect UI without forwarding raw error payloads", async () => {
  const fixture = setup()
  await fixture.controller.connect(); await fixture.controller.send("hello")
  fixture.emit({ type: "protocol-error", cwd: "/workspace", message: "secret raw payload" })
  assert.equal(fixture.controller.snapshot().phase, "disconnected")
  assert.doesNotMatch(JSON.stringify(fixture.controller.snapshot()), /secret raw payload|\/workspace/)
  await fixture.controller.dispose()
})

for (const [event, code] of [
  [{ type: "protocol-error", cwd: "/private/workspace", message: "secret-token raw frame" }, "CORE_PROTOCOL_ERROR"],
  [{ type: "authentication-invalidated", message: "secret-token account info" }, "CORE_AUTH_INVALIDATED"],
  [{ type: "connection-closed", cwd: "/private/workspace", exit: { code: 7, signal: null, expected: false } }, "CORE_PROCESS_EXIT"],
] as const) it(`reports ${code} without exposing Core payloads and permits reconnection`, async () => {
  const f = setup()
  const reports: string[] = []
  const controller = new ChatController({ connect: async () => f.session, assertTrusted() {}, publish() {}, interact: async () => null,
    report(operation, error) { assert.ok(error instanceof UserVisibleError); reports.push(`${operation}: ${error.message}`) },
  })
  try {
    await controller.connect(); await controller.send("hello")
    f.emit(event)
    assert.equal(controller.snapshot().phase, "disconnected")
    assert.match(controller.snapshot().notice!, new RegExp(code))
    assert.equal(reports.length, 1)
    assert.match(reports[0]!, new RegExp(code))
    assert.doesNotMatch(JSON.stringify([controller.snapshot(), reports]), /secret-token|raw frame|account info|private/)
    assert.notEqual(controller.snapshot().turnTimings[0]!.finishedAt, null)
    await controller.connect()
    assert.equal(controller.snapshot().phase, "ready")
  } finally { await controller.dispose(); await f.controller.dispose() }
})

it("changes model and effort on the same thread and applies modes using the displayed revision", async () => {
  const fixture = setup()
  await fixture.controller.connect(); await fixture.controller.send("first")
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
  await new Promise((done) => setImmediate(done))
  let resumed = false
  fixture.host.resumeThread = async (_cwd, id, settings) => {
    assert.equal(id, "thread-1"); assert.equal(settings.model, "other-model"); assert.equal(settings.intelligence, "high"); resumed = true
  }
  fixture.host.setModes = async (input) => {
    assert.equal(input.expectedRevision, 1); assert.equal(input.permissionMode, "auto"); assert.equal(input.workMode, "plan")
    return { revision: 2, permissionEpoch: 2, permissionMode: "auto", workMode: "plan" }
  }
  await fixture.controller.configure(async (settings) => ({ ...settings, model: "other-model", intelligence: "high", permissionMode: "auto", workMode: "plan" }))
  assert.equal(resumed, true)
  assert.equal(fixture.controller.snapshot().model, "other-model")
  assert.equal(fixture.controller.snapshot().effort, "high")
  assert.equal(fixture.controller.snapshot().permission, "auto")
  await fixture.controller.send("second")
  assert.equal(fixture.counts().starts, 1)
  assert.equal(fixture.counts().turns, 2)
  await fixture.controller.dispose()
})

it("blocks sends during native pickers, keeps cancelled settings, and rejects ambiguous configuration failures", async () => {
  const fixture = setup()
  await fixture.controller.connect()
  let finish: (value: null) => void = () => undefined
  const selecting = fixture.controller.configure(() => new Promise((resolve) => { finish = resolve }))
  assert.equal(fixture.controller.snapshot().phase, "configuring")
  await fixture.controller.send("must not send")
  assert.equal(fixture.counts().turns, 0)
  finish(null); await selecting
  assert.equal(fixture.controller.snapshot().phase, "ready")
  await fixture.controller.send("first")
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
  await new Promise((done) => setImmediate(done))
  fixture.host.resumeThread = async () => { fixture.host.readModes = async () => { throw new Error("thread no longer loaded") }; throw new Error("secret MCP credentials") }
  await fixture.controller.configure(async (settings) => ({ ...settings, model: "other-model" }))
  assert.equal(fixture.controller.snapshot().phase, "disconnected")
  assert.doesNotMatch(JSON.stringify(fixture.controller.snapshot()), /secret MCP credentials/)
  assert.equal(fixture.counts().turns, 1) // A failed settings change must not automatically replay a turn.
  assert.equal(await fixture.controller.send("reconnect and send"), true)
  assert.equal(fixture.counts().connections, 2)
  assert.equal(fixture.counts().starts, 2)
  assert.equal(fixture.counts().turns, 2)
  await fixture.controller.dispose()
})

it("permission changes use the revision before the picker even if Core changes it while choosing", async () => {
  const fixture = setup()
  await fixture.controller.connect(); await fixture.controller.send("first")
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
  await new Promise((done) => setImmediate(done))
  fixture.host.setModes = async (input) => {
    assert.equal(input.expectedRevision, 1)
    fixture.host.readModes = async () => ({ revision: 2, permissionEpoch: 2, permissionMode: "auto", workMode: "normal" })
    throw new Error("revision conflict")
  }
  await fixture.controller.configure(async (settings) => {
    fixture.emit({ type: "thread-modes-updated", threadId: "thread-1", state: { revision: 2, permissionEpoch: 2, permissionMode: "auto", workMode: "normal" } })
    return { ...settings, permissionMode: "yolo" }
  })
  assert.equal(fixture.controller.snapshot().phase, "ready")
  assert.equal(fixture.controller.snapshot().permission, "auto")
  assert.match(fixture.controller.snapshot().notice!, /未应用/)
  await fixture.controller.dispose()
})

it("publishes opaque diff handles, rejects invented handles, and retires them on new chat", async () => {
  const fixture = setup()
  await fixture.controller.connect(); await fixture.controller.send("first")
  fixture.emit({ type: "file-diff", threadId: "thread-1", turnId: "turn-1", itemId: "file", diff: { source: { kind: "tool", toolCallId: "call" }, path: "/private/secret/project/file.ts", changeType: "modified", stats: { linesAdded: 1, linesRemoved: 2 }, preview: { kind: "omitted" } } })
  const row = fixture.controller.snapshot().diffs[0]!
  assert.equal(row.label, "file.ts")
  assert.equal(row.turnId, "turn-1")
  assert.equal(row.available, true)
  fixture.emit({ type: "file-diff", threadId: "thread-1", turnId: "turn-1", itemId: "file", diff: { source: { kind: "tool", toolCallId: "call" }, path: "/private/secret/project/file.ts", changeType: "modified", stats: { linesAdded: 3, linesRemoved: 2 }, preview: { kind: "omitted" } } })
  assert.equal(fixture.controller.snapshot().diffs.length, 1)
  assert.equal(fixture.controller.snapshot().diffs[0]!.id, row.id)
  assert.equal(fixture.controller.snapshot().diffs[0]!.added, 3)
  assert.ok(!fixture.controller.snapshot().messages.some(message => message.artifacts?.some(item => item.kind === "diff")), "Diffs no longer live inside folded tool records")
  assert.doesNotMatch(JSON.stringify(fixture.controller.snapshot()), /\/private/)
  let shown = 0
  await fixture.controller.showDiff("invented", async () => { shown++ })
  await fixture.controller.showDiff(row.id, async (diff) => { assert.equal(diff.path, "/private/secret/project/file.ts"); shown++ })
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
  await new Promise((done) => setImmediate(done))
  await fixture.controller.newChat()
  await fixture.controller.showDiff(row.id, async () => { shown++ })
  assert.equal(shown, 1)
  assert.deepEqual(fixture.controller.snapshot().diffs, [])
  await fixture.controller.dispose()
})

it("background processes use host-owned IDs and logs, with task cancellation separate from process termination", async () => {
  const fixture = setup()
  fixture.host.listBackgroundTerminals = async () => ({ cwd: "/workspace", terminals: [{ processId: 4321, logPath: "/private/core/log.txt", inProgress: true }] })
  await fixture.controller.connect(); await fixture.controller.send("first")
  await fixture.controller.refreshBackground()
  const row = fixture.controller.snapshot().background[0]!
  assert.doesNotMatch(JSON.stringify(fixture.controller.snapshot()), /4321|\/private/)
  let terminated = 0
  fixture.host.terminateBackgroundTerminal = async (_cwd, thread, pid) => { assert.equal(thread, "thread-1"); assert.equal(pid, 4321); terminated++ }
  await fixture.controller.terminateBackground("4321")
  await fixture.controller.terminateBackground(row.id)
  assert.equal(terminated, 1)
  await fixture.controller.showBackgroundLog(row.id, async (path) => { assert.equal(path, "/private/core/log.txt") })
  fixture.emit({ type: "background-wake", threadId: "thread-1", turnId: "turn-1", taskId: "actual-task", phase: "queued" })
  fixture.host.cancelBackgroundTask = async (_cwd, _thread, taskId) => { assert.equal(taskId, "actual-task"); return "cancelled" }
  await fixture.controller.cancelTask(fixture.controller.snapshot().backgroundTasks[0]!.id)
  assert.equal(fixture.controller.snapshot().backgroundTasks[0]?.phase, "cancelled")
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
  fixture.emit({ type: "turn-started", threadId: "thread-1", turnId: "wake-turn", submissionId: null })
  assert.equal(fixture.controller.snapshot().phase, "running")
  fixture.emit({ type: "text-delta", threadId: "thread-1", turnId: "wake-turn", itemId: "answer", delta: "background result" })
  assert.equal(fixture.controller.snapshot().messages.at(-1)?.text, "background result")
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "wake-turn", outcome: "completed", stopReason: "end", error: null })
  assert.equal(fixture.controller.snapshot().phase, "ready")
  await fixture.controller.dispose()
})

it("stale background results do not resurrect state after disconnect", async () => {
  const fixture = setup()
  await fixture.controller.connect(); await fixture.controller.send("first")
  let release: () => void = () => undefined
  fixture.host.listBackgroundTerminals = () => new Promise((resolve) => { release = () => resolve({ cwd: "/workspace", terminals: [{ processId: 1, logPath: "/secret", inProgress: true }] }) })
  const refresh = fixture.controller.refreshBackground()
  await new Promise((done) => setImmediate(done))
  fixture.emit({ type: "protocol-error", cwd: "/workspace", message: "broken" })
  release(); await refresh
  assert.deepEqual(fixture.controller.snapshot().background, [])
  await fixture.controller.dispose()
})

it("MCP settings reach Core but credentials never enter the snapshot; tools use the Core list", async () => {
  const fixture = setup()
  await fixture.controller.connect()
  const server = { type: "stdio" as const, name: "fixture", command: "/private/bin/node", args: ["/private/server.js"], env: [{ name: "API_KEY", value: "credential-secret" }] }
  await fixture.controller.configure(async (settings) => ({ ...settings, mcpServers: [server] }))
  fixture.host.startThread = async (_cwd, settings) => { assert.deepEqual(settings.mcpServers, [server]); return "thread-1" }
  await fixture.controller.refreshTools()
  assert.deepEqual(fixture.controller.snapshot().tools, ["read_files", "mcp__fixture__echo"])
  assert.deepEqual(fixture.controller.snapshot().mcpNames, ["fixture"])
  assert.doesNotMatch(JSON.stringify(fixture.controller.snapshot()), /credential-secret|\/private/)
  await fixture.controller.dispose()
})

it("sends native attachments without exposing paths, deduplicates and keeps them on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemAttachments"))
  const fixture = setup()
  try {
    const file = join(root, "notes.txt"); const image = join(root, "photo.png"); const directory = join(root, "folder")
    await writeFile(file, "hello"); await writeFile(image, "image fixture"); await mkdir(directory)
    await fixture.controller.connect()
    const attachments = [{ kind: "file" as const, path: file }, { kind: "image" as const, path: image }, { kind: "directory" as const, path: directory }]
    await fixture.controller.addAttachments(async () => [...attachments, attachments[0]!])
    await fixture.controller.addAttachments(async () => attachments)
    assert.equal(fixture.controller.snapshot().attachments.length, 3)
    assert.doesNotMatch(JSON.stringify(fixture.controller.snapshot()), new RegExp(root))
    fixture.host.startTurn = async (input) => { assert.deepEqual(input.attachments, attachments); throw new Error("failed") }
    await fixture.controller.send("describe")
    assert.equal(fixture.controller.snapshot().attachments.length, 3)
    assert.equal(fixture.controller.snapshot().phase, "ready")
    fixture.host.startTurn = async (input) => { assert.deepEqual(input.attachments, attachments); return "turn-2" }
    await fixture.controller.send("retry")
    assert.equal(fixture.controller.snapshot().attachments.length, 0)
    const sent = fixture.controller.snapshot().messages.at(-1)
    assert.ok(sent && "attachments" in sent)
    assert.equal(sent.attachments?.length, 3)
  } finally { await fixture.controller.dispose(); await rm(root, { recursive: true, force: true }) }
})

it("rejects images for non-vision models and revalidates files removed after picking", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemAttachments"))
  const fixture = setup()
  try {
    const image = join(root, "photo.png"); await writeFile(image, "fixture")
    await fixture.controller.connect()
    await fixture.controller.addAttachments(async () => [{ kind: "image", path: image }])
    await fixture.controller.configure(async (settings) => ({ ...settings, model: "other-model" }))
    await fixture.controller.send("describe")
    assert.equal(fixture.counts().turns, 0)
    assert.match(fixture.controller.snapshot().notice!, /不支持图片/)
    await rm(image)
    await fixture.controller.send("describe again")
    assert.equal(fixture.counts().turns, 0)
    fixture.controller.removeAttachment(fixture.controller.snapshot().attachments[0]!.id)
    assert.deepEqual(fixture.controller.snapshot().attachments, [])
  } finally { await fixture.controller.dispose(); await rm(root, { recursive: true, force: true }) }
})

it("ignores late native attachment results after disposal and rejects more than 20 attachments", async () => {
  const fixture = setup()
  await fixture.controller.connect()
  await fixture.controller.addAttachments(async () => Array.from({ length: 21 }, (_, index) => ({ kind: "file", path: `/unique-${index}` })))
  assert.match(fixture.controller.snapshot().notice!, /20/)
  assert.deepEqual(fixture.controller.snapshot().attachments, [])
  let resolve: (value: []) => void = () => undefined
  const adding = fixture.controller.addAttachments(() => new Promise((done) => { resolve = done }))
  await fixture.controller.dispose()
  resolve([]); await adding
  assert.deepEqual(fixture.controller.snapshot().attachments, [])
})

it("retains a confirmed model update if a following mode write conflicts", async () => {
  const fixture = setup()
  await fixture.controller.connect(); await fixture.controller.send("first")
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
  fixture.host.setModes = async () => { throw new Error("mode conflict") }
  await fixture.controller.configure(async (settings) => ({ ...settings, model: "other-model", permissionMode: "auto" }))
  assert.equal(fixture.controller.snapshot().phase, "ready")
  assert.equal(fixture.controller.snapshot().model, "other-model")
  assert.equal(fixture.controller.snapshot().permission, "default")
  assert.ok(fixture.controller.snapshot().notice)
  await fixture.controller.dispose()
})

it("shows empty reasoning immediately, streams whitespace and retains content on completion", async () => {
  const f = setup()
  try {
    await f.controller.connect(); await f.controller.send("hello")
    f.emit({ type: "item-started", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem({ id: "thought", type: "reasoning", status: "inProgress" }, "fixture") })
    assert.deepEqual(f.controller.snapshot().messages.at(-1), { id: "turn-1:thought", turnId: "turn-1", role: "reasoning", label: "思考过程", status: "running", text: "", summary: "" })
    for (const delta of [" first\n", " second "]) f.emit({ type: "reasoning-delta", threadId: "thread-1", turnId: "turn-1", itemId: "thought", delta })
    f.emit({ type: "item-completed", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem({ id: "thought", type: "reasoning", status: "completed" }, "fixture") })
    assert.deepEqual(f.controller.snapshot().messages.at(-1), { id: "turn-1:thought", turnId: "turn-1", role: "reasoning", label: "思考过程", status: "completed", text: " first\n second ", summary: "" })
  } finally { await f.controller.dispose() }
})

it("correlates tool calls and results, preserves tool names and separates summaries from output", async () => {
  const f = setup()
  try {
    await f.controller.connect(); await f.controller.send("hello")
    const emitItem = (type: "item-started" | "item-completed", value: unknown) => f.emit({ type, threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem(value, "fixture") })
    emitItem("item-started", { id: "exec", type: "commandExecution", status: "inProgress", tool: "run_bash", arguments: { command: "echo card", env: { SECRET: "host-only-input" } } })
    for (const delta of [" line one\n", "line two "]) f.emit({ type: "item-output-delta", threadId: "thread-1", turnId: "turn-1", itemId: "exec", toolCallId: "call-1", delta })
    emitItem("item-completed", { id: "result", type: "toolResult", callId: "call-1", status: "completed", summary: "exit 0" })
    assert.deepEqual(f.controller.snapshot().messages.slice(1), [{ id: "turn-1:tool:exec", turnId: "turn-1", role: "tool", label: "run_bash", status: "completed", text: " line one\nline two ", summary: "exit 0", details: { kind: "command", fields: [], code: "echo card" } }])
    emitItem("item-completed", { id: "result", type: "toolResult", callId: "call-1", status: "completed", output: "full output" })
    assert.equal(f.controller.snapshot().messages.at(-1)?.text, "full output")
    f.emit({ type: "item-output-delta", threadId: "thread-1", turnId: "turn-1", itemId: "exec", toolCallId: "call-1", delta: "\nlate progress" })
    const completed = f.controller.snapshot().messages.at(-1)
    assert.ok(completed && "status" in completed)
    assert.equal(completed.status, "completed")
    assert.doesNotMatch(JSON.stringify(f.controller.snapshot()), /host-only-input/)
    emitItem("item-completed", { id: "mcp", type: "mcpToolCall", tool: "mcp__fixture__echo", status: "completed", isError: true, output: "tool error" })
    assert.deepEqual(f.controller.snapshot().messages.at(-1), { id: "turn-1:tool:mcp", turnId: "turn-1", role: "tool", label: "MCP · mcp__fixture__echo", status: "failed", text: "tool error", summary: "" })
  } finally { await f.controller.dispose() }
})

it("updates tools first seen as output and keeps final_answer results out of tool cards", async () => {
  const f = setup()
  try {
    await f.controller.connect(); await f.controller.send("hello")
    f.emit({ type: "item-output-delta", threadId: "thread-1", turnId: "turn-1", itemId: "exec", toolCallId: "call-1", delta: "progress" })
    f.emit({ type: "item-started", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem({ id: "exec", type: "toolCall", status: "inProgress", tool: "read_files", callId: "call-1" }, "fixture") })
    assert.equal(f.controller.snapshot().messages.length, 2)
    assert.equal(f.controller.snapshot().messages.at(-1)?.label, "read_files")
    for (const item of [
      { id: "final", type: "toolCall", status: "completed", tool: "final_answer", callId: "final-call", arguments: { summary: "answer", kind: "chat" } },
      { id: "final-result", type: "toolResult", status: "completed", callId: "final-call", output: "accepted" },
    ]) f.emit({ type: "item-completed", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem(item, "fixture") })
    assert.equal(f.controller.snapshot().messages.at(-1)?.text, "answer")
    assert.equal(f.controller.snapshot().messages.length, 3)
  } finally { await f.controller.dispose() }
})

for (const outcome of ["completed", "failed", "stopped", "disconnected"] as const) it(`settles pending output on ${outcome} without inventing tool success`, async () => {
  const f = setup()
  try {
    await f.controller.connect(); await f.controller.send("hello")
    f.emit({ type: "reasoning-delta", threadId: "thread-1", turnId: "turn-1", itemId: "reasoning", delta: "thinking" })
    f.emit({ type: "item-output-delta", threadId: "thread-1", turnId: "turn-1", itemId: "tool", toolCallId: "call", delta: "partial" })
    if (outcome === "disconnected") f.emit({ type: "protocol-error", cwd: "/workspace", message: "fixture error" })
    else f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome, stopReason: "fixture", error: null })
    const messages = f.controller.snapshot().messages.slice(1)
    const expected = outcome === "completed" ? ["completed", "incomplete"] : Array(2).fill(outcome === "stopped" ? "interrupted" : outcome === "disconnected" ? "incomplete" : "failed")
    assert.deepEqual(messages.map((message) => "status" in message ? message.status : null), expected)
    assert.deepEqual(messages.map((message) => message.text), ["thinking", "partial"])
  } finally { await f.controller.dispose() }
})

it("a rejected send preserves retry intent without a phantom sent message", async () => {
  const fixture = setup()
  fixture.host.startTurn = async () => { throw new Error("Rejected") }
  await fixture.controller.connect()
  assert.equal(await fixture.controller.send("keep my draft"), false)
  assert.equal(fixture.controller.snapshot().phase, "ready")
  assert.deepEqual(fixture.controller.snapshot().messages, [])
  await fixture.controller.dispose()
})

it("a start notification proves acceptance when the RPC reply fails and keeps the run active", async () => {
  const fixture = setup()
  fixture.host.startTurn = async (input) => {
    fixture.emit({ type: "turn-started", threadId: "thread-1", turnId: "accepted", submissionId: input.submissionId })
    throw new Error("Reply lost")
  }
  await fixture.controller.connect()
  assert.equal(await fixture.controller.send("accepted message"), true)
  assert.equal(fixture.controller.snapshot().phase, "running")
  fixture.emit({ type: "turn-completed", threadId: "thread-1", turnId: "accepted", outcome: "completed", stopReason: "end", error: null })
  assert.equal(fixture.controller.snapshot().phase, "ready")
  await fixture.controller.dispose()
})


it("keeps late reasoning and tool completion before the terminal reply without reversing work order", async () => {
  const f = setup()
  try {
    await f.controller.connect(); await f.controller.send("test ordering")
    f.emit({ type: "text-delta", threadId: "thread-1", turnId: "turn-1", itemId: "answer", delta: "reply" })
    f.emit({ type: "item-completed", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem({ id: "final", type: "toolCall", tool: "final_answer", status: "completed", arguments: { status: "complete", kind: "chat", summary: "final reply", artifacts: [] } }, "fixture") })
    f.emit({ type: "reasoning-delta", threadId: "thread-1", turnId: "turn-1", itemId: "lateThought", delta: "thought" })
    f.emit({ type: "item-completed", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem({ id: "lateTool", type: "toolCall", tool: "read_files", status: "completed" }, "fixture") })
    assert.deepEqual(f.controller.snapshot().messages.map(m => m.role), ["user", "assistant", "reasoning", "tool", "assistant"])
    assert.equal(f.controller.snapshot().messages.at(-1)?.text, "final reply")
  } finally { await f.controller.dispose() }
})

it("loads large image bytes only on demand and expires removed image handles", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemLazyImage"))
  const f = setup()
  try {
    const path = join(root, "large.png")
    const bytes = Buffer.alloc(1024 * 1024); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes)
    await writeFile(path, bytes)
    await f.controller.connect()
    await f.controller.addAttachments(async () => [{ kind: "image", path }])
    const item = f.controller.snapshot().attachments[0]!
    assert.deepEqual(item.preview, { kind: "deferred" })
    assert.equal((await f.controller.loadImage(item.id)).kind, "image")
    assert.equal((await f.controller.loadImage("forged")).kind, "unavailable")
    f.controller.removeAttachment(item.id)
    assert.equal((await f.controller.loadImage(item.id)).kind, "unavailable")
  } finally { await f.controller.dispose(); await rm(root, { recursive: true, force: true }) }
})


it("restores schema 13 image handles and rejects changed durable image bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemHistoryImage"))
  const previousRoot = process.env.LINCO_SESSIONS_ROOT
  process.env.LINCO_SESSIONS_ROOT = root
  const f = setup()
  try {
    const directory = join(root, createHash("sha256").update(f.session.cwd).digest("hex").slice(0, 16))
    const imageDirectory = join(directory, "thread-1", "attachments")
    await mkdir(imageDirectory, { recursive: true })
    const bytes = Buffer.alloc(1024 * 1024); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes)
    const imagePath = join(imageDirectory, "image.png"); await writeFile(imagePath, bytes)
    const at = "2026-09-20T00:00:00Z"
    const records = [
      { type: "header", schema_version: 13, session_id: "thread-1", cwd: f.session.cwd, started_at: at, model: "fixture", provider: "openai_compat" },
      { type: "user_invocation", at, submission_id: "s1", input: { kind: "message", content: "历史图片", attachments: [{ kind: "image", path: "attachments/image.png", sha256: createHash("sha256").update(bytes).digest("hex"), media_type: "image/png", width: 1, height: 1, bytes: bytes.length, display_name: "历史图片.png" }] } },
      { type: "turn_request", at, turn_index: 0, model: "fixture" },
      { type: "assistant_text", at, text: "完成" },
      { type: "turn_end", at, turn_index: 0, stop_reason: "EndTurn" },
    ]
    await writeFile(join(directory, "thread-1.jsonl"), records.map((record, i) => JSON.stringify({ ...record, record_seq: i + 1 })).join("\n") + "\n")
    f.session.readHistory = createSessionHistoryReader({ cwd: f.session.cwd, sessionsRoot: root, authorize: async () => {} })
    await f.controller.connect(); await f.controller.send("test")
    f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
    await f.controller.reloadHistory()
    const user = f.controller.snapshot().messages.find(message => message.role === "user")!
    assert.ok("attachments" in user)
    const image = user.attachments![0]!
    assert.equal(image.label, "历史图片.png"); assert.deepEqual(image.preview, { kind: "deferred" })
    assert.doesNotMatch(JSON.stringify(user), /attachments\/image|sha256|data:image/)
    assert.equal((await f.controller.loadImage(image.id)).kind, "image")
    bytes[100] = 1; await writeFile(imagePath, bytes)
    assert.equal((await f.controller.loadImage(image.id)).kind, "unavailable")
    await f.controller.newChat()
    assert.equal((await f.controller.loadImage(image.id)).kind, "unavailable")
  } finally {
    if (previousRoot === undefined) delete process.env.LINCO_SESSIONS_ROOT
    else process.env.LINCO_SESSIONS_ROOT = previousRoot
    await f.controller.dispose(); await rm(root, { recursive: true, force: true })
  }
})

it("keeps final artifacts through late reply updates and expires their open handles", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemFinalArtifact"))
  const f = setup(); f.session.cwd = root
  try {
    await writeFile(join(root, "report.txt"), "done")
    await f.controller.connect(); await f.controller.send("test")
    f.emit({ type: "item-completed", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem({ id: "final", type: "toolCall", tool: "final_answer", status: "completed", arguments: { status: "complete", kind: "task", summary: "done", artifacts: [{ kind: "file", title: "Report", path: "report.txt" }] } }, "fixture") })
    const reply = f.controller.snapshot().messages.find(message => message.role === "assistant")!
    const artifact = reply.artifacts![0]!
    f.emit({ type: "item-completed", threadId: "thread-1", turnId: "turn-1", item: parseAppServerItem({ id: "finalAnswer", type: "agentMessage", status: "completed", text: "done, with details" }, "fixture") })
    assert.equal(f.controller.snapshot().messages.find(message => message.id === reply.id)!.artifacts![0]!.id, artifact.id)
    let opened = 0
    await f.controller.openArtifact(artifact.id, async source => { assert.equal(source.kind, "file"); opened++ })
    assert.equal(opened, 1)
    f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
    await f.controller.newChat()
    await f.controller.openArtifact(artifact.id, async () => { opened++ })
    assert.equal(opened, 1)
  } finally { await f.controller.dispose(); await rm(root, { recursive: true, force: true }) }
})


it("switches space only after preflight, resets the conversation and retires the old host", async () => {
  const previous = setup(), next = setup()
  await previous.controller.connect()
  next.session.space = { key: "nextSpace", name: "另一个空间" }
  await previous.controller.selectSpace(async current => {
    assert.equal(current.space.key, "testSpace")
    assert.equal(previous.controller.snapshot().phase, "configuring")
    assert.equal(await previous.controller.send("must not send while choosing"), false)
    return next.session
  })
  assert.equal(previous.counts().closed, 1)
  assert.equal(previous.controller.snapshot().space, "另一个空间")
  assert.equal(previous.controller.snapshot().threadId, null)
  assert.deepEqual(previous.controller.snapshot().messages, [])
  assert.equal(previous.controller.snapshot().phase, "ready")
  await previous.controller.dispose()
  assert.equal(next.counts().closed, 1)
  await next.controller.dispose()
})

it("preserves current space on cancelled or failed selection and blocks switching during a turn", async () => {
  const fixture = setup()
  await fixture.controller.connect()
  await fixture.controller.selectSpace(async () => null)
  await fixture.controller.selectSpace(async () => { throw new Error("preflight failure") })
  assert.equal(fixture.counts().closed, 0)
  assert.equal(fixture.controller.snapshot().space, "测试空间")
  assert.equal(fixture.controller.snapshot().phase, "ready")
  assert.match(fixture.controller.snapshot().notice!, /空间切换失败/)
  await fixture.controller.send("running")
  let called = false
  await fixture.controller.selectSpace(async () => { called = true; return null })
  assert.equal(called, false)
  await fixture.controller.dispose()
})

it("closes a prepared space when the view is disposed during selection", async () => {
  const previous = setup(), next = setup()
  await previous.controller.connect()
  await previous.controller.selectSpace(async () => {
    await previous.controller.dispose()
    return next.session
  })
  assert.equal(previous.counts().closed, 1)
  assert.equal(next.counts().closed, 1)
  await next.controller.dispose()
})


it("restores selected settings after controller restart and retains them for new chats", async () => {
  const data = new Map<string, unknown>()
  const preferences = new ConnectionPreferences({ get: <T>(key: string) => data.get(key) as T | undefined, update: async (key, value) => { data.set(key, value) } })
  const fixture = setup()
  const make = () => new ChatController({ preferences, connect: async () => fixture.session, assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  const first = make()
  await first.connect()
  await first.configure(async settings => ({ ...settings, model: "other-model", intelligence: "high", permissionMode: "auto", workMode: "plan" }))
  await first.dispose()
  const reopened = make()
  await reopened.connect()
  for (const check of [async () => {}, () => reopened.newChat()]) {
    await check()
    const state = reopened.snapshot()
    assert.equal(state.model, "other-model"); assert.equal(state.effort, "high")
    assert.equal(state.permission, "auto"); assert.equal(state.workMode, "plan")
  }
  await reopened.configure(async () => null)
  assert.equal((await preferences.load(fixture.session))?.model, "other-model")
  await reopened.dispose(); await fixture.controller.dispose()
})

it("reports unavailable saved models without overwriting the preference", async () => {
  const fixture = setup()
  let writes = 0
  const controller = new ChatController({ preferences: { load: async () => ({ model: "removed-model", intelligence: "high", permissionMode: "default", workMode: "plan" }), save: async () => { writes++ } }, connect: async () => fixture.session, assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  await controller.connect()
  assert.equal(controller.snapshot().model, "model-from-core")
  assert.equal(controller.snapshot().effort, "high")
  assert.match(controller.snapshot().notice!, /已保存的模型当前不可用/)
  assert.equal(writes, 0)
  await controller.dispose(); await fixture.controller.dispose()
})

it("a settings persistence failure leaves the applied selection visible with a warning", async () => {
  const fixture = setup()
  const controller = new ChatController({ preferences: { load: async () => null, save: async () => { throw new Error("disk full") } }, connect: async () => fixture.session, assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  await controller.connect()
  await controller.configure(async settings => ({ ...settings, intelligence: "high" }))
  assert.equal(controller.snapshot().effort, "high")
  assert.match(controller.snapshot().notice!, /配置已应用，但保存失败/)
  await controller.dispose(); await fixture.controller.dispose()
})


it("opens space choices without authentication IO and ignores cancelled selection", async () => {
  const f = setup()
  await f.controller.connect()
  f.session.authorize = async () => { throw new Error("Menu must not spawn auth") }
  let opened = false
  await f.controller.selectSpace(async () => { opened = true; return null })
  assert.equal(opened, true)
  assert.equal(f.counts().closed, 0)
  assert.equal(f.controller.snapshot().phase, "ready")
  await f.controller.dispose()
})

it("shows the prepared space before slow old-host cleanup and waits for cleanup on disposal", async () => {
  const old = setup(), next = setup()
  await old.controller.connect()
  let release!: () => void
  old.host.close = () => new Promise<void>(resolve => { release = resolve })
  next.session.space = { key: "next", name: "新空间" }
  await old.controller.selectSpace(async () => next.session)
  assert.equal(old.controller.snapshot().space, "新空间")
  assert.equal(old.controller.snapshot().phase, "ready")
  old.emit({ type: "connection-closed", cwd: "/workspace", exit: { code: 0, signal: null } } as unknown as AppServerHostEvent)
  assert.equal(old.controller.snapshot().phase, "ready", "Old host events have no authority")
  let disposed = false
  const closing = old.controller.dispose().then(() => { disposed = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(disposed, false)
  release(); await closing
  assert.equal(disposed, true)
  await next.controller.dispose()
})


it("shutdown gate: repeated disposal waits for the same host cleanup", async () => {
  const fixture = setup()
  await fixture.controller.connect()
  let release!: () => void
  let closeCalls = 0
  fixture.host.close = () => { closeCalls++; return new Promise<void>(resolve => { release = resolve }) }
  const first = fixture.controller.dispose()
  const second = fixture.controller.dispose()
  let settled = false
  void second.then(() => { settled = true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false, "Repeated disposal must not report completion while the host is alive")
    assert.equal(first, second, "All callers must observe one disposal promise")
    assert.equal(closeCalls, 1)
  } finally { release(); await Promise.all([first, second]) }
})

it("shutdown gate: disposal waits for cleanup started by a connection failure", async () => {
  const fixture = setup()
  await fixture.controller.connect()
  let release!: () => void
  fixture.host.close = () => new Promise<void>(resolve => { release = resolve })
  fixture.emit({ type: "protocol-error", cwd: "/workspace", message: "fixture failure" })
  let settled = false
  const closing = fixture.controller.dispose().then(() => { settled = true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false, "Event-triggered cleanup belongs to the controller lifetime")
  } finally { release(); await closing }
})

it("shutdown gate: disposal reports cleanup failure after every host settles", async () => {
  const old = setup(), next = setup()
  await old.controller.connect()
  let rejectOld!: (error: Error) => void
  old.host.close = () => new Promise<void>((_resolve, reject) => { rejectOld = reject })
  await old.controller.selectSpace(async () => next.session)
  let releaseNext!: () => void
  next.host.close = () => new Promise<void>(resolve => { releaseNext = resolve })
  const closing = old.controller.dispose()
  const failure = assert.rejects(closing, /cleanup/i)
  let settled = false
  void closing.then(() => { settled = true }, () => { settled = true })
  try {
    rejectOld(new Error("old host cleanup failed"))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false, "A failure must not skip cleanup of other hosts")
  } finally { releaseNext(); await failure; await next.controller.dispose() }
})

it("times correlated turns once, keeps ticking through stop acknowledgement, and settles on completion", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 })
  const f = setup()
  try {
    await f.controller.connect(); await f.controller.send("first")
    assert.deepEqual(f.controller.snapshot().turnTimings, [{ turnId: "turn-1", startedAt: 1000, finishedAt: null }])
    f.emit({ type: "reasoning-delta", threadId: "thread-1", turnId: "turn-1", itemId: "reason", delta: "thinking" })
    assert.equal(f.controller.snapshot().messages[1]!.turnId, "turn-1")
    t.mock.timers.setTime(36_000)
    const beforeActivity = f.controller.snapshot()
    for (let i = 0; i < 2; i++) f.emit({ type: "turn-activity", threadId: "thread-1", turnId: "turn-1", source: "provider_stream" })
    assert.deepEqual(f.controller.snapshot().messages, beforeActivity.messages, "Activity cannot replace transcript content")
    assert.deepEqual(f.controller.snapshot().turnTimings, beforeActivity.turnTimings, "Activity cannot reset the turn clock")
    assert.equal(f.controller.snapshot().phase, beforeActivity.phase, "Activity cannot change turn lifecycle")
    f.emit({ type: "turn-started", threadId: "thread-1", turnId: "turn-1", submissionId: f.submission() })
    f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "foreign", outcome: "completed", stopReason: "end", error: null })
    await f.controller.stop()
    assert.equal(f.controller.snapshot().turnTimings[0]!.startedAt, 1000)
    assert.equal(f.controller.snapshot().turnTimings[0]!.finishedAt, null)
    t.mock.timers.setTime(37_000)
    f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "stopped", stopReason: "end", error: null })
    t.mock.timers.setTime(90_000)
    f.emit({ type: "turn-activity", threadId: "thread-1", turnId: "turn-1", source: "provider_stream" })
    assert.equal(f.controller.snapshot().phase, "ready", "A retired heartbeat cannot reopen a turn")
    f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
    assert.equal(f.controller.snapshot().turnTimings[0]!.finishedAt, 37_000)
    await f.controller.send("second")
    assert.equal(f.controller.snapshot().turnTimings[1]!.startedAt, 90_000)
    f.emit({ type: "connection-closed", cwd: "/workspace", exit: { code: null, signal: null, expected: false } })
    assert.equal(f.controller.snapshot().turnTimings[1]!.finishedAt, 90_000)
  } finally { await f.controller.dispose() }
})

it("platform text generation creates one thread, reuses the connection and waits for the correlated side-question terminal", async () => {
  const f = setup(); let calls = 0; let auth = 0
  f.session.authorize = async () => { auth++ }
  f.host.startSideQuestion = async (_cwd, threadId, operationId, question) => {
    calls++
    f.emit({ type: "side-question-started", threadId, operationId, sideQuestionId: "side-1", question })
    f.emit({ type: "side-question-delta", threadId: "rogue", sideQuestionId: "side-1", delta: "wrong" })
    f.emit({ type: "side-question-delta", threadId, sideQuestionId: "side-1", delta: '{"insertText":"ok"}' })
    f.emit({ type: "side-question-completed", threadId, sideQuestionId: "side-1", status: "completed", error: null })
    return "side-1"
  }
  await f.controller.connect()
  assert.equal(await f.controller.generateText("complete", new AbortController().signal, f.controller.contextKey()), '{"insertText":"ok"}')
  assert.equal(await f.controller.generateText("again", new AbortController().signal, f.controller.contextKey()), '{"insertText":"ok"}')
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().turns, 0); assert.equal(calls, 2); assert.equal(auth, 2)
  assert.equal(f.controller.snapshot().phase, "ready")
  await f.controller.dispose()
})

it("platform generation cancellation sends one cancel and does not complete on its receipt", async () => {
  const f = setup(); let cancels = 0
  f.host.startSideQuestion = async (_cwd, threadId, operationId, question) => {
    f.emit({ type: "side-question-started", threadId, operationId, sideQuestionId: "side-1", question }); return "side-1"
  }
  f.host.cancelSideQuestion = async () => { cancels++ }
  await f.controller.connect()
  const abort = new AbortController()
  const pending = f.controller.generateText("complete", abort.signal, f.controller.contextKey())
  const rejected = assert.rejects(pending, /取消|失败/)
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(f.controller.generateText("duplicate", new AbortController().signal, f.controller.contextKey()), /等待/)
  abort.abort(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(cancels, 1); assert.equal(f.controller.snapshot().phase, "sideQuestion")
  f.emit({ type: "side-question-completed", threadId: "thread-1", sideQuestionId: "side-1", status: "interrupted", error: null })
  await rejected
  assert.equal(f.controller.snapshot().phase, "ready")
  await f.controller.dispose()
})

it("platform generation rejects startup failures and closes pending results on disconnect", async () => {
  const f = setup(); await f.controller.connect()
  await assert.rejects(f.controller.generateText("complete", new AbortController().signal, f.controller.contextKey()), /生成未能启动/)
  assert.equal(f.controller.snapshot().phase, "ready")
  f.host.startSideQuestion = async (_cwd, threadId, operationId, question) => {
    f.emit({ type: "side-question-started", threadId, operationId, sideQuestionId: "side-1", question }); return "side-1"
  }
  const rejected = assert.rejects(f.controller.generateText("complete", new AbortController().signal, f.controller.contextKey()), /连接已关闭/)
  await new Promise(resolve => setImmediate(resolve))
  await f.controller.dispose(); await rejected
})

it("platform generation rejects a context captured before a conversation switch without issuing a request", async () => {
  const f = setup(); await f.controller.connect()
  const previous = f.controller.contextKey()
  await f.controller.send("hello")
  f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
  await assert.rejects(f.controller.generateText("stale source", new AbortController().signal, previous), /会话已切换/)
  assert.equal(f.controller.snapshot().phase, "ready")
  await f.controller.dispose()
})


it("lazy send failure preserves the request for explicit retry and never starts a turn", async () => {
  const f = setup()
  let attempts = 0
  const c = new ChatController({ connect: async () => { if (++attempts === 1) throw new UserVisibleError("已取消选择工作区。"); return f.session }, assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  assert.equal(await c.send("retained draft"), false)
  assert.equal(c.snapshot().phase, "disconnected")
  assert.equal(c.snapshot().notice, "已取消选择工作区。")
  assert.equal(f.counts().turns, 0)
  assert.equal(await c.send("retained draft"), true)
  assert.equal(attempts, 2)
  assert.equal(c.snapshot().messages[0]?.text, "retained draft")
  f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "stop", error: null })
  assert.equal(await c.send("second message"), true)
  assert.equal(attempts, 2)
  assert.equal(f.counts().turns, 2)
  await c.dispose()
})

it("lazy send does not resume after disposal and closes a late connection", async () => {
  const f = setup()
  let resolve!: (session: ChatSession) => void
  let attempts = 0
  const c = new ChatController({ connect: () => { attempts++; return new Promise(done => { resolve = done }) }, assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  const pending = c.send("first")
  assert.equal(await c.send("duplicate"), false)
  await c.dispose()
  resolve(f.session)
  assert.equal(await pending, false)
  assert.equal(attempts, 1)
  assert.equal(f.counts().turns, 0)
  assert.equal(f.counts().closed, 1)
})

it("lazy send still enforces workspace trust before opening a connection", async () => {
  let attempts = 0
  const c = new ChatController({ connect: async () => { attempts++; throw Error("must not connect") }, assertTrusted() { throw new UserVisibleError("workspace is untrusted") }, publish() {}, interact: async () => null, report() {} })
  assert.equal(await c.send("hello"), false)
  assert.equal(attempts, 0)
  assert.equal(c.snapshot().notice, "workspace is untrusted")
  await c.dispose()
})

it("model selection connects on demand and a cancelled picker does not create a thread", async () => {
  const f = setup()
  let picked = false
  await f.controller.configure(async () => { picked = true; return null })
  assert.equal(picked, true)
  assert.equal(f.counts().connections, 1)
  assert.equal(f.counts().starts, 0)
  assert.equal(await f.controller.send("hello"), true)
  assert.equal(f.counts().connections, 1)
  await f.controller.dispose()
})

it("a new conversation invalidates a first send still waiting for connection bookkeeping", async () => {
  const f = setup()
  let finish!: () => void
  let connected!: () => void
  const ready = new Promise<void>(done => { connected = done })
  const c = new ChatController({ connect: async () => f.session, connected: () => { connected(); return new Promise<void>(done => { finish = done }) }, assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  const pending = c.send("old context")
  await ready
  await c.newChat()
  finish()
  assert.equal(await pending, false)
  assert.equal(f.counts().turns, 0)
  await c.dispose()
})

it("opening history connects on demand without creating a conversation", async () => {
  const f = setup()
  await f.controller.showHistory()
  assert.equal(f.counts().connections, 1)
  assert.equal(f.counts().starts, 0)
  assert.equal(f.controller.snapshot().history.open, true)
  await f.controller.dispose()
})

it("renders one stable outgoing message before slow connection and thread creation finish", async () => {
  const f = setup()
  let connect!: (session: ChatSession) => void
  let createThread!: (id: string) => void
  let creating!: () => void
  const threadStarted = new Promise<void>(resolve => { creating = resolve })
  const published: ReturnType<ChatController["snapshot"]>[] = []
  f.host.startThread = () => { creating(); return new Promise(resolve => { createThread = resolve }) }
  const c = new ChatController({ connect: () => new Promise(resolve => { connect = resolve }), assertTrusted() {}, publish: state => published.push(state), interact: async () => null, report() {} })
  const send = c.send("show immediately")
  assert.equal(c.snapshot().phase, "connecting")
  const outgoing = c.snapshot().messages[0]!
  assert.equal(outgoing.text, "show immediately")
  assert.equal(outgoing.role, "user")
  assert.equal(f.counts().turns, 0)
  connect(f.session)
  await threadStarted
  assert.equal(c.snapshot().phase, "sending")
  assert.equal(c.snapshot().messages[0]?.id, outgoing.id)
  assert.equal(f.counts().turns, 0)
  createThread("thread-1")
  assert.equal(await send, true)
  assert.equal(f.submission(), outgoing.id)
  for (const state of published) {
    assert.equal(state.messages.filter(message => message.role === "user").length, 1)
    assert.equal(state.messages[0]?.id, outgoing.id)
  }
  assert.equal(c.snapshot().messages.filter(message => message.id === outgoing.id).length, 1)
  await c.dispose()
})

it("removes an unaccepted outgoing preview on connection failure and gives retry a fresh identity", async () => {
  const f = setup()
  let fail!: (error: Error) => void
  let attempts = 0
  const c = new ChatController({ connect: () => ++attempts === 1 ? new Promise((_resolve, reject) => { fail = reject }) : Promise.resolve(f.session), assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  const pending = c.send("retained draft")
  const firstId = c.snapshot().messages[0]?.id
  assert.ok(firstId)
  fail(new UserVisibleError("连接失败"))
  assert.equal(await pending, false)
  assert.deepEqual(c.snapshot().messages, [])
  assert.equal(c.snapshot().notice, "连接失败")
  assert.equal(await c.send("retained draft"), true)
  assert.notEqual(c.snapshot().messages[0]?.id, firstId)
  assert.equal(c.snapshot().messages.length, 1)
  await c.dispose()
})
