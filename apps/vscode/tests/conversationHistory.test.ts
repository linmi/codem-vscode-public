import assert from "node:assert/strict"
import { it } from "node:test"
import { DEFAULT_APP_SERVER_THREAD_SETTINGS } from "@codem/app-server"
import type { SessionHistoryPage } from "@codem/history"
import { ConversationHistory, HistoryRestoreFailure, type HistoryContext } from "../src/sessionHistory/conversationHistory.ts"

function fixture() {
  const calls: string[] = []
  const history = new ConversationHistory(() => {})
  const page: SessionHistoryPage = { todoSnapshot: null, turns: [], nextCursor: "older" }
  const context: HistoryContext = {
    cwd: "/workspace", connected: () => true, assertCurrent() {},
    async authorize() { calls.push("authorize") },
    async readHistory() { calls.push("history"); return page },
    host: {
      async readThread(_cwd, id) { calls.push("read"); return { id, cwd: "/workspace", archived: false, model: "model", profile: "default", startedAt: "2026-09-19T00:00:00Z", name: null, status: "idle" } },
      async resumeThread() { calls.push("resume") },
      async readModes() { calls.push("modes"); return { revision: 1, permissionEpoch: 1, permissionMode: "default", workMode: "normal" } },
      async unsubscribeThread(_cwd, id) { calls.push(`release:${id}`) },
    },
  }
  return { history, context, calls, page }
}

it("history restore owns the cursor and releases the previous subscription only after successful replay", async () => {
  const f = fixture()
  await f.history.restore(f.context, { threadId: "new", settings: DEFAULT_APP_SERVER_THREAD_SETTINGS, detached: false, previous: () => "old" }, ({ page }) => {
    assert.equal(page, f.page)
    assert.equal(f.history.busy, true)
    assert.equal(f.history.hasOlder, true)
    f.calls.push("commit")
  })
  assert.deepEqual(f.calls, ["authorize", "read", "resume", "modes", "history", "release:old", "commit"])
  assert.equal(f.history.busy, false)
})

it("candidate turn interrupts restoration and retains exclusion through cleanup", async () => {
  const f = fixture()
  let release!: (page: SessionHistoryPage) => void
  let started!: () => void
  const reading = new Promise<void>(resolve => { started = resolve })
  f.context.readHistory = () => { started(); return new Promise(resolve => { release = resolve }) }
  let committed = false
  const pending = f.history.restore(f.context, { threadId: "new", settings: DEFAULT_APP_SERVER_THREAD_SETTINGS, detached: false, previous: () => "old" }, () => { committed = true })
  await reading
  f.history.turnStarted("new", "old")
  assert.equal(f.history.busy, true)
  await assert.rejects(f.history.load(f.context, "old", false, () => {}), /already in progress/)
  release(f.page); await pending
  assert.equal(committed, false)
  assert.deepEqual(f.calls.filter(call => call.startsWith("release:")), ["release:new"])
  assert.equal(f.history.busy, false)
})

it("cleanup uncertainty requires disconnect while a recoverable failure preserves the old subscription", async () => {
  for (const cleanupFails of [false, true]) {
    const f = fixture()
    f.context.readHistory = async () => { throw new Error("cannot read") }
    f.context.host.unsubscribeThread = async (_cwd, id) => { f.calls.push(`release:${id}`); if (cleanupFails) throw new Error("cannot release") }
    await assert.rejects(f.history.restore(f.context, { threadId: "new", settings: DEFAULT_APP_SERVER_THREAD_SETTINGS, detached: false, previous: () => "old" }, () => assert.fail("unexpected commit")), error => error instanceof HistoryRestoreFailure && error.disconnect === cleanupFails)
    assert.deepEqual(f.calls.filter(call => call.startsWith("release:")), ["release:new"])
    assert.equal(f.history.busy, false)
  }
})

it("reset and late read completion cannot clear a replacement read lease or commit its cursor", async () => {
  const f = fixture()
  const resolve: ((page: SessionHistoryPage) => void)[] = []
  f.context.readHistory = () => new Promise(done => { resolve.push(done) })
  const first = f.history.load(f.context, "old", false, () => assert.fail("stale commit"))
  f.history.reset()
  const second = f.history.load(f.context, "new", false, () => {})
  resolve[0]!(f.page); await first
  assert.equal(f.history.busy, true)
  assert.equal(f.history.hasOlder, false)
  resolve[1]!({ todoSnapshot: null, turns: [], nextCursor: null }); await second
  assert.equal(f.history.busy, false)
  assert.equal(f.history.hasOlder, false)
})

it("failed page validation clears pagination and requires an explicit fresh read", async () => {
  const f = fixture()
  await f.history.restore(f.context, { threadId: "thread", settings: DEFAULT_APP_SERVER_THREAD_SETTINGS, detached: false, previous: () => null }, () => {})
  await assert.rejects(f.history.load(f.context, "thread", true, () => assert.fail("repeated cursor must be rejected")), /did not advance/)
  assert.equal(f.history.hasOlder, false)
  await assert.rejects(f.history.load(f.context, "thread", false, () => { throw new Error("overlap") }), /overlap/)
  assert.equal(f.history.hasOlder, false)
  await f.history.load(f.context, "thread", false, () => {})
  assert.equal(f.history.hasOlder, true)
})

it("a realtime turn arriving during publication keeps pagination invalidated", async () => {
  const f = fixture()
  await f.history.load(f.context, "thread", false, () => f.history.invalidate())
  assert.equal(f.history.hasOlder, false)
  assert.equal(f.history.busy, false)
})
