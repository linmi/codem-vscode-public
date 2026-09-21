import { ActiveConversation } from "../src/sessionHistory/activeConversation.ts"
import { capabilityHostFixture } from "./capabilityHostFixture.ts"
import { fixtureSpaceDirectory } from "./spaceFixtures.ts"
import assert from "node:assert/strict"
import { it } from "node:test"
import type { AppServerHostEvent } from "@codem/app-server"
import type { SessionHistoryPage } from "@codem/session-history"
import { ChatController, type ChatHost, type ChatSession } from "../src/chat/chatController.ts"

const at = "2026-09-19T00:00:00Z"
function page(index: number, nextCursor: string | null): SessionHistoryPage {
  return { todoSnapshot: null, nextCursor, turns: [{ submissionId: `old-${index}`, turn: { id: `old-turn-${index}`, index, engineTurnIndexes: [index], model: "model", provider: "fixture", startedAt: at, completedAt: at, state: "completed", usage: null, items: [{ id: `user-${index}`, at, kind: "message", role: "user", text: `question ${index}`, attachments: [] }, { id: `answer-${index}`, at, kind: "message", role: "assistant", text: `answer ${index}`, delivery: null }] } }] }
}
function setup(activeConversation?: ActiveConversation) {
  let listener: (event: AppServerHostEvent) => void = () => {}
  let trusted = true
  const resumed: string[] = []
  const released: string[] = []
  const sent: string[] = []
  const read: (string | undefined)[] = []
  let starts = 0
  const host: ChatHost = {
    ...capabilityHostFixture(),
    onEvent(callback) { listener = callback; return () => { listener = () => {} } },
    async listThreads() { return { threads: ["history-1", "history-2"].map((id) => ({ id, cwd: "/workspace", archived: false, model: "model", profile: "default", preview: id, startedAt: at, turnCount: 2 })), nextCursor: null, total: 2 } },
    async readThread(_cwd, id) { return { id, cwd: "/workspace", archived: false, model: "model", profile: "default", startedAt: at, name: null, status: "idle" } },
    async resumeThread(_cwd, id) { resumed.push(id) },
    async unsubscribeThread(_cwd, id) { released.push(id) },
    async startThread() { starts++; return "new-thread" },
    async startTurn(input) { sent.push(input.threadId); listener({ type: "turn-started", threadId: input.threadId, turnId: "live-turn", submissionId: input.submissionId }); return "live-turn" },
    async readModes() { return { revision: 1, permissionEpoch: 1, permissionMode: "default", workMode: "plan" } },
    async setModes() { throw new Error("restoration must preserve Core modes") },
    async listTools() { return { threadId: "history-1", model: "model", tools: [] } },
    async listBackgroundTerminals() { return { cwd: "/workspace", terminals: [] } },
    async terminateBackgroundTerminal() {},
    async cleanBackgroundTerminals() { return { cwd: "/workspace", results: [] } },
    async cancelBackgroundTask() { return "cancelled" },
    async interruptTurn() {}, async respondToInteraction() {}, async close() {},
  }
  const session: ChatSession = { host, cwd: "/workspace", workspace: "project", space: { key: "testSpace", name: "测试空间" }, spaceDirectory: fixtureSpaceDirectory(), model: "model", models: [{ id: "model", source: "fixture", contextWindowTokens: 10000, supportsVision: true }], mcpServers: [], authorize: async () => { assert.ok(trusted) }, readHistory: async (_id, cursor) => { read.push(cursor); return cursor ? page(0, null) : page(1, "older") } }
  const snapshots: ReturnType<ChatController["snapshot"]>[] = []
  const chat = new ChatController({ activeConversation, connect: async () => session, assertTrusted() { assert.ok(trusted) }, publish(state) { snapshots.push(state) }, interact: async () => null, report() {} })
  return { chat, host, session, snapshots, resumed, released, sent, read, starts: () => starts, untrust: () => { trusted = false }, emit: (event: AppServerHostEvent) => listener(event) }
}

it("toggles history open, closed and open again without fetching on close", async () => {
  const f = setup()
  let requests = 0
  const listThreads = f.host.listThreads
  f.host.listThreads = async (...args) => { requests++; return listThreads(...args) }
  try {
    await f.chat.toggleHistory()
    assert.equal(f.chat.snapshot().history.open, true)
    const entries = f.chat.snapshot().history.entries
    assert.equal(requests, 1)
    await f.chat.toggleHistory()
    assert.equal(f.chat.snapshot().history.open, false)
    assert.deepEqual(f.chat.snapshot().history.entries, entries)
    assert.equal(requests, 1)
    await f.chat.toggleHistory()
    assert.equal(f.chat.snapshot().history.open, true)
    assert.equal(requests, 2)
  } finally { await f.chat.dispose() }
})

for (const failed of [false, true]) {
  it(`keeps history closed when a pending list request ${failed ? "fails" : "completes"}`, async () => {
    const f = setup()
    let requests = 0
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const listThreads = f.host.listThreads
    f.host.listThreads = async (...args) => {
      requests++
      await pending
      if (failed) throw new Error("list failed")
      return listThreads(...args)
    }
    try {
      await f.chat.connect()
      const opening = f.chat.toggleHistory()
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(f.chat.snapshot().history.open, true)
      assert.equal(f.chat.snapshot().history.loading, true)
      await f.chat.toggleHistory()
      assert.equal(f.chat.snapshot().history.open, false)
      assert.equal(requests, 1)
      finish()
      await opening
      assert.equal(f.chat.snapshot().history.open, false)
      assert.equal(f.chat.snapshot().history.loading, false)
      assert.equal(f.chat.snapshot().history.error !== null, failed)
      assert.equal(requests, 1)
    } finally { finish(); await f.chat.dispose() }
  })
}

it("restores a listed thread, prepends older turns and continues the same Core identity", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    assert.equal(f.chat.snapshot().threadId, "history-1")
    assert.equal(f.chat.snapshot().history.open, false)
    assert.equal(f.chat.snapshot().workMode, "plan")
    assert.equal(f.chat.snapshot().hasOlderMessages, true)
    await f.chat.loadOlderMessages()
    assert.deepEqual(f.chat.snapshot().messages.map((message) => message.text), ["question 0", "answer 0", "question 1", "answer 1"])
    assert.equal(f.chat.snapshot().hasOlderMessages, false)
    await f.chat.send("continue")
    assert.deepEqual(f.sent, ["history-1"])
    assert.equal(f.starts(), 0)
    assert.equal(f.chat.snapshot().historyNeedsRefresh, true)
    f.emit({ type: "text-delta", threadId: "history-1", turnId: "live-turn", itemId: "answer", delta: "new answer" })
    assert.equal(f.chat.snapshot().messages.at(-1)?.text, "new answer")
  } finally { await f.chat.dispose() }
})

it("denies unlisted IDs, traversal and history operations during a live turn", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.resumeThread("history-1"); await f.chat.resumeThread("../history-1")
    assert.deepEqual(f.resumed, [])
    await f.chat.showHistory(); await f.chat.resumeThread("history-1"); await f.chat.send("continue")
    await f.chat.resumeThread("history-2"); await f.chat.loadOlderMessages(); await f.chat.reloadHistory()
    assert.deepEqual(f.resumed, ["history-1"])
    assert.deepEqual(f.read, [undefined])
    assert.equal(f.chat.snapshot().threadId, "history-1")
  } finally { await f.chat.dispose() }
})

it("keeps current messages on failed pagination and requires an explicit fresh snapshot", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    const old = f.chat.snapshot().messages
    f.session.readHistory = async () => { throw new Error("changed /private/path secret") }
    await f.chat.loadOlderMessages()
    assert.deepEqual(f.chat.snapshot().messages, old)
    assert.equal(f.chat.snapshot().phase, "ready")
    assert.equal(f.chat.snapshot().hasOlderMessages, false)
    assert.equal(f.chat.snapshot().historyNeedsRefresh, true)
    assert.doesNotMatch(JSON.stringify(f.chat.snapshot()), /private|secret/)
    f.session.readHistory = async () => page(2, "fresh")
    await f.chat.reloadHistory()
    assert.deepEqual(f.chat.snapshot().messages.map((message) => message.text), ["question 2", "answer 2"])
    assert.equal(f.chat.snapshot().historyNeedsRefresh, false)
    assert.equal(f.chat.snapshot().hasOlderMessages, true)
  } finally { await f.chat.dispose() }
})

it("prevents concurrent restores and drops a replay if the connection retires", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory()
    let resolve: (value: SessionHistoryPage) => void = () => {}
    f.session.readHistory = () => new Promise((done) => { resolve = done })
    const restoring = f.chat.resumeThread("history-1")
    await new Promise((done) => setImmediate(done))
    await f.chat.resumeThread("history-2")
    assert.deepEqual(f.resumed, ["history-1"])
    f.emit({ type: "protocol-error", cwd: "/workspace", message: "connection retired" })
    resolve(page(1, null)); await restoring
    assert.equal(f.chat.snapshot().phase, "disconnected")
    assert.deepEqual(f.chat.snapshot().messages, [])
    assert.deepEqual(f.chat.snapshot().history.entries, [])
  } finally { await f.chat.dispose() }
})

it("failed recovery leaves the previous thread usable and unsubscribes the failed target", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    f.session.readHistory = async () => { throw new Error("invalid JSONL") }
    await f.chat.resumeThread("history-2")
    assert.equal(f.chat.snapshot().threadId, "history-1")
    assert.equal(f.chat.snapshot().messages[0]?.text, "question 1")
    assert.deepEqual(f.released, ["history-2"])
    await f.chat.send("continue old thread")
    assert.deepEqual(f.sent, ["history-1"])
  } finally { await f.chat.dispose() }
})

it("a background turn arriving during replay keeps realtime authority", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    let resolve: (value: SessionHistoryPage) => void = () => {}
    f.session.readHistory = () => new Promise((done) => { resolve = done })
    const reading = f.chat.loadOlderMessages()
    await new Promise((done) => setImmediate(done))
    f.emit({ type: "turn-started", threadId: "history-1", turnId: "background-turn", submissionId: null })
    f.emit({ type: "text-delta", threadId: "history-1", turnId: "background-turn", itemId: "answer", delta: "live background answer" })
    resolve(page(0, null)); await reading
    assert.equal(f.chat.snapshot().phase, "running")
    assert.equal(f.chat.snapshot().messages.at(-1)?.text, "live background answer")
    assert.ok(!f.chat.snapshot().messages.some((message) => message.text === "question 0"))
  } finally { await f.chat.dispose() }
})

it("switching and new chat clear the prior viewport cursor; revoked trust cannot read history", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    await f.chat.resumeThread("history-2")
    assert.deepEqual(f.released, ["history-1"])
    await f.chat.newChat()
    assert.equal(f.chat.snapshot().threadId, null)
    assert.equal(f.chat.snapshot().hasOlderMessages, false)
    f.untrust()
    await f.chat.resumeThread("history-1")
    assert.deepEqual(f.resumed, ["history-1", "history-2"])
  } finally { await f.chat.dispose() }
})

it("accepts empty histories and refuses archived or wrong-workspace recovery before subscribing", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory()
    f.host.readThread = async () => { throw new Error("belongs to another workspace") }
    await f.chat.resumeThread("history-1")
    assert.deepEqual(f.resumed, [])
    f.host.readThread = async (_cwd, id) => ({ id, cwd: "/workspace", archived: true, model: "model", profile: "default", startedAt: at, name: null, status: "idle" })
    await f.chat.resumeThread("history-1")
    assert.deepEqual(f.resumed, [])
    f.host.readThread = async (_cwd, id) => ({ id, cwd: "/workspace", archived: false, model: "model", profile: "default", startedAt: at, name: null, status: "idle" })
    f.session.readHistory = async () => ({ todoSnapshot: null, turns: [], nextCursor: null })
    await f.chat.resumeThread("history-1")
    assert.equal(f.chat.snapshot().threadId, "history-1")
    assert.equal(f.chat.snapshot().phase, "ready")
    assert.deepEqual(f.chat.snapshot().messages, [])
  } finally { await f.chat.dispose() }
})

it("disconnects when a failed switch cannot safely release the candidate thread", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    f.session.readHistory = async () => { throw new Error("invalid JSONL") }
    f.host.unsubscribeThread = async () => { throw new Error("subscription state unknown") }
    await f.chat.resumeThread("history-2")
    assert.equal(f.chat.snapshot().phase, "disconnected")
    assert.equal(f.chat.snapshot().threadId, null)
    assert.equal(f.chat.snapshot().messages[0]?.text, "question 1")
    assert.deepEqual(f.sent, []) // Failure itself never submits to the uncertain thread.
    assert.equal(await f.chat.send("reconnect into a new conversation"), true)
    assert.deepEqual(f.sent, ["new-thread"])
    assert.equal(f.starts(), 1)
  } finally { await f.chat.dispose() }
})

it("does not begin another restore until an aborted replay has finished cleanup", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    let resolve: (value: SessionHistoryPage) => void = () => {}
    f.session.readHistory = () => new Promise((done) => { resolve = done })
    const reading = f.chat.loadOlderMessages()
    await new Promise((done) => setImmediate(done))
    f.emit({ type: "turn-started", threadId: "history-1", turnId: "background-turn", submissionId: null })
    f.emit({ type: "turn-completed", threadId: "history-1", turnId: "background-turn", outcome: "completed", stopReason: "end", error: null })
    await f.chat.resumeThread("history-2")
    assert.deepEqual(f.resumed, ["history-1"])
    resolve(page(0, null)); await reading
    f.session.readHistory = async () => page(3, null)
    await f.chat.resumeThread("history-2")
    assert.equal(f.chat.snapshot().threadId, "history-2")
    assert.deepEqual(f.released, ["history-1"])
  } finally { await f.chat.dispose() }
})


it("restores durable diff handles with turn ownership and retires old handles on history reload", async () => {
  const f = setup()
  try {
    const history = page(0, null)
    const turn = history.turns[0]!.turn
    f.session.readHistory = async () => ({ ...history, turns: [{ ...history.turns[0]!, turn: { ...turn, items: [...turn.items, { id: "diff", at: turn.startedAt, kind: "file-diff", runId: "run", source: { kind: "checkpoint", checkpointId: "checkpoint" }, diff: { path: "/private/project/src/file.ts", changeType: "modified", stats: { linesAdded: 1, linesRemoved: 0 }, preview: { kind: "omitted" } } }] } }] })
    await f.chat.connect()
    await f.chat.showHistory()
    await f.chat.resumeThread("history-1")
    const first = f.chat.snapshot().diffs[0]!
    assert.equal(first.turnId, turn.id)
    assert.equal(first.available, true)
    assert.doesNotMatch(JSON.stringify(first), /private/)
    let opened = 0
    await f.chat.showDiff(first.id, async value => { assert.equal(value.stats.linesAdded, 1); opened++ })
    await f.chat.reloadHistory()
    await f.chat.showDiff(first.id, async () => { opened++ })
    const second = f.chat.snapshot().diffs[0]!
    assert.notEqual(first.id, second.id)
    await f.chat.showDiff(second.id, async () => { opened++ })
    assert.equal(opened, 2)
    f.session.readHistory = async () => { throw new Error("read failed") }
    await f.chat.reloadHistory()
    assert.deepEqual(f.chat.snapshot().diffs, [second])
  } finally { await f.chat.dispose() }
})

it("new chat does not bypass an aborted history read that still owns cleanup", async () => {
  const f = setup()
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    let resolve!: (value: SessionHistoryPage) => void
    f.session.readHistory = () => new Promise(done => { resolve = done })
    const reading = f.chat.loadOlderMessages()
    await new Promise(done => setImmediate(done))
    f.emit({ type: "turn-started", threadId: "history-1", turnId: "background-turn", submissionId: null })
    f.emit({ type: "turn-completed", threadId: "history-1", turnId: "background-turn", outcome: "completed", stopReason: "end", error: null })
    await f.chat.newChat()
    await f.chat.resumeThread("history-2")
    assert.equal(f.chat.snapshot().threadId, null)
    assert.deepEqual(f.resumed, ["history-1"])
    resolve(page(0, null)); await reading
    f.session.readHistory = async () => page(3, null)
    await f.chat.resumeThread("history-2")
    assert.equal(f.chat.snapshot().threadId, "history-2")
    assert.equal(f.chat.snapshot().messages[0]?.text, "question 3")
  } finally { await f.chat.dispose() }
})


function bookmarks() {
  const data = new Map<string, unknown>()
  const store = { get: <T>(key: string) => data.get(key) as T | undefined, update: async (key: string, value: unknown) => { data.set(key, value) } }
  return { data, store, open: () => new ActiveConversation(store) }
}
function scope(session: ChatSession) { return { cwd: session.cwd, spaceKey: session.space.key, accountKey: session.spaceDirectory.accountKey } }

it("reload restores the selected Core conversation before ready, without listing or creating threads", async () => {
  const saved = bookmarks()
  const first = setup(saved.open())
  await first.chat.connect(); await first.chat.showHistory(); await first.chat.resumeThread("history-2")
  const messages = first.chat.snapshot().messages
  await first.chat.dispose()
  const reloaded = setup(saved.open())
  reloaded.host.listThreads = async () => { throw new Error("Recovery must not load the history catalog") }
  try {
    await reloaded.chat.connect()
    assert.equal(reloaded.chat.snapshot().threadId, "history-2")
    assert.deepEqual(reloaded.chat.snapshot().messages, messages)
    assert.equal(reloaded.chat.snapshot().hasOlderMessages, true)
    assert.deepEqual(reloaded.resumed, ["history-2"])
    assert.deepEqual(reloaded.read, [undefined])
    assert.equal(reloaded.starts(), 0)
    assert.equal(reloaded.snapshots.filter(state => state.phase === "ready").every(state => state.threadId === "history-2" && state.messages.length === 2), true)
    await reloaded.chat.send("continue after reload")
    assert.deepEqual(reloaded.sent, ["history-2"])
  } finally { await reloaded.chat.dispose() }
})

for (const operation of ["create", "send", "tools"] as const) {
  it(`persists a Core identity established by ${operation} before reload`, async () => {
    const saved = bookmarks()
    const first = setup(saved.open())
    await first.chat.connect()
    if (operation === "create") await first.chat.createThread()
    else if (operation === "send") await first.chat.send("first prompt")
    else await first.chat.refreshTools()
    await first.chat.dispose()
    const second = setup(saved.open())
    try {
      await second.chat.connect()
      assert.equal(second.chat.snapshot().threadId, "new-thread")
      assert.deepEqual(second.resumed, ["new-thread"])
      assert.equal(second.starts(), 0)
    } finally { await second.chat.dispose() }
  })
}

it("explicit new chat clears the bookmark and stays blank after reload", async () => {
  const saved = bookmarks()
  const first = setup(saved.open())
  await first.chat.connect(); await first.chat.showHistory(); await first.chat.resumeThread("history-1")
  await first.chat.newChat(); await first.chat.dispose()
  const second = setup(saved.open())
  try {
    await second.chat.connect()
    assert.equal(second.chat.snapshot().threadId, null)
    assert.deepEqual(second.chat.snapshot().messages, [])
    assert.deepEqual(second.resumed, [])
    assert.equal(second.starts(), 0)
  } finally { await second.chat.dispose() }
})

it("failed new chat preserves the bookmark; a closed thread removes it", async () => {
  const saved = bookmarks(), persistence = saved.open(), f = setup(persistence)
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    f.host.unsubscribeThread = async () => { throw new Error("release failed") }
    await f.chat.newChat()
    assert.equal(await persistence.load(scope(f.session)), "history-1")
    f.emit({ type: "thread-closed", cwd: f.session.cwd, threadId: "history-1", reason: "thread/archive" })
    assert.equal(await persistence.load(scope(f.session)), null)
  } finally { await f.chat.dispose() }
})

for (const failure of ["missing", "archived", "history", "liveTurn"] as const) {
  it(`keeps the bookmark and input without auto-sending when recovery encounters ${failure}`, async () => {
    const saved = bookmarks(), persistence = saved.open(), f = setup(persistence)
    await persistence.save(scope(f.session), "history-1")
    if (failure === "missing") f.host.readThread = async () => { throw new Error("missing /private secret") }
    if (failure === "archived") {
      const read = f.host.readThread
      f.host.readThread = async (...args) => ({ ...await read(...args), archived: true })
    }
    if (failure === "history") f.session.readHistory = async () => { throw new Error("invalid JSONL /private secret") }
    if (failure === "liveTurn") f.session.readHistory = async () => { f.emit({ type: "turn-started", threadId: "history-1", turnId: "background", submissionId: null }); return page(1, null) }
    try {
      assert.equal(await f.chat.send("do not submit into a different conversation"), false)
      assert.equal(f.chat.snapshot().phase, "ready")
      assert.equal(f.chat.snapshot().threadId, null)
      assert.ok(f.chat.snapshot().notice)
      assert.doesNotMatch(JSON.stringify(f.chat.snapshot()), /private|secret/)
      assert.equal(await persistence.load(scope(f.session)), "history-1")
      assert.deepEqual(f.sent, [])
      assert.equal(f.starts(), 0)
      assert.deepEqual(f.released, failure === "history" || failure === "liveTurn" ? ["history-1"] : [])
      await f.chat.newChat()
      assert.equal(await persistence.load(scope(f.session)), null)
    } finally { await f.chat.dispose() }
  })
}

it("a lazy send that restores a previous conversation retains the input for explicit resubmission", async () => {
  const saved = bookmarks(), persistence = saved.open(), f = setup(persistence)
  await persistence.save(scope(f.session), "history-1")
  try {
    assert.equal(await f.chat.send("pending input"), false)
    assert.equal(f.chat.snapshot().threadId, "history-1")
    assert.match(f.chat.snapshot().notice!, /输入已保留/)
    assert.deepEqual(f.sent, [])
    assert.equal(await f.chat.send("pending input"), true)
    assert.deepEqual(f.sent, ["history-1"])
  } finally { await f.chat.dispose() }
})

it("late recovery cannot publish after disposal, and disposal retains the bookmark", async () => {
  const saved = bookmarks(), persistence = saved.open(), f = setup(persistence)
  await persistence.save(scope(f.session), "history-1")
  let finish!: (value: SessionHistoryPage) => void
  let reading!: () => void
  const started = new Promise<void>(resolve => { reading = resolve })
  f.session.readHistory = () => { reading(); return new Promise(resolve => { finish = resolve }) }
  const connecting = f.chat.connect()
  await started
  assert.equal(f.chat.snapshot().phase, "connecting")
  await f.chat.newChat()
  assert.equal(await f.chat.send("blocked during recovery"), false)
  await f.chat.dispose()
  const count = f.snapshots.length
  finish(page(1, null)); await connecting
  assert.equal(f.snapshots.length, count)
  assert.equal(f.chat.snapshot().threadId, null)
  assert.equal(await persistence.load(scope(f.session)), "history-1")
})

it("switching spaces restores only that space's last conversation", async () => {
  const saved = bookmarks(), persistence = saved.open(), f = setup(persistence), other = setup()
  other.session.space = { key: "other", name: "Other" }
  await persistence.save(scope(f.session), "history-1")
  await persistence.save(scope(other.session), "history-2")
  try {
    await f.chat.connect()
    await f.chat.selectSpace(async () => other.session)
    assert.equal(f.chat.snapshot().threadId, "history-2")
    assert.deepEqual(other.resumed, ["history-2"])
    assert.equal(await persistence.load(scope(f.session)), "history-1")
  } finally { await f.chat.dispose(); await other.chat.dispose() }
})

it("failed bookmark persistence is visible without losing the live conversation", async () => {
  const saved = bookmarks(), f = setup(saved.open())
  saved.store.update = async () => { throw new Error("disk failure secret") }
  try {
    await f.chat.connect(); await f.chat.showHistory(); await f.chat.resumeThread("history-1")
    assert.equal(f.chat.snapshot().threadId, "history-1")
    assert.match(f.chat.snapshot().notice!, /位置保存失败/)
    assert.equal(f.chat.snapshot().messages.length, 2)
    assert.doesNotMatch(f.chat.snapshot().notice!, /secret/)
  } finally { await f.chat.dispose() }
})

it("new chat chosen offline suppresses recovery on the next authenticated connection", async () => {
  const saved = bookmarks(), persistence = saved.open(), f = setup(persistence)
  await persistence.save(scope(f.session), "history-1")
  try {
    await f.chat.newChat()
    await f.chat.connect()
    assert.equal(f.chat.snapshot().threadId, null)
    assert.deepEqual(f.resumed, [])
    assert.equal(await persistence.load(scope(f.session)), null)
  } finally { await f.chat.dispose() }
})

it("restores current tasks from history, keeps them on pagination/read failure and clears them on a different session", async t => {
  const f = setup(); t.after(() => f.chat.dispose())
  const snapshot = { kind: "added", summary: "当前任务", lastChange: null, counts: { completed: 0, pending: 1, inProgress: 0 }, items: [{ id: "t-check", content: "检查接口", activeForm: null, blockedBy: [], status: "pending" as const, createdAtMs: 1, updatedAtMs: 1 }] }
  f.session.readHistory = async (threadId, cursor) => ({ ...page(cursor ? 0 : 1, cursor ? null : "older"), todoSnapshot: threadId === "history-1" && !cursor ? snapshot : null })
  await f.chat.showHistory(); await f.chat.resumeThread("history-1")
  const plan = [{ content: "检查接口", status: "pending" }]
  assert.deepEqual(f.chat.snapshot().capabilities.plan, plan)
  await f.chat.loadOlderMessages()
  assert.deepEqual(f.chat.snapshot().capabilities.plan, plan)
  const read = f.session.readHistory
  f.session.readHistory = async () => { throw new Error("read failed") }
  await f.chat.reloadHistory()
  assert.deepEqual(f.chat.snapshot().capabilities.plan, plan)
  f.session.readHistory = read
  await f.chat.showHistory(); await f.chat.resumeThread("history-2")
  assert.deepEqual(f.chat.snapshot().capabilities.plan, [])
})
