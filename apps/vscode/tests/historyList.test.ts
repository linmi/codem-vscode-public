import assert from "node:assert/strict"
import { it } from "node:test"
import type { AppServerThreadSummary } from "@codem/app-server"
import { HistoryListController, type HistoryListContext } from "../src/historyList.ts"

async function readThread(cwd: string, id: string) { return { ...entry(id), cwd, name: id === "a" ? "已保存的名称" : null, status: "idle" } }

function entry(id: string): AppServerThreadSummary {
  return { id, cwd: "/host-only", archived: false, model: "model", profile: "profile", preview: `question ${id}`, startedAt: "2026-09-19T00:00:00Z", turnCount: 1 }
}

it("loads and deduplicates Core pages, replaces on refresh, and exposes only display fields", async () => {
  const browser = new HistoryListController(() => {}, () => {})
  let authorizations = 0
  const cursors: (string | undefined)[] = []
  browser.bind({ cwd: "/host-only", authorize: async () => { authorizations++ }, host: { readThread, async listThreads(cwd, cursor) {
    assert.equal(cwd, "/host-only"); cursors.push(cursor)
    return { threads: cursor ? [entry("b"), entry("c")] : [entry("a"), entry("b")], nextCursor: cursor ? null : "opaque-host-cursor", total: 3 }
  } } })
  await browser.open()
  assert.equal(browser.snapshot().open, true)
  assert.equal(browser.snapshot().entries[0]?.title, "已保存的名称")
  assert.equal(browser.snapshot().hasMore, true)
  await browser.more()
  await browser.more()
  assert.deepEqual(browser.snapshot().entries.map((thread) => thread.id), ["a", "b", "c"])
  assert.equal(browser.snapshot().hasMore, false)
  assert.deepEqual(cursors, [undefined, "opaque-host-cursor"])
  assert.equal(authorizations, 2)
  assert.doesNotMatch(JSON.stringify(browser.snapshot()), /host-only|opaque-host-cursor|profile|model/)
  await browser.refresh()
  assert.deepEqual(browser.snapshot().entries.map((thread) => thread.id), ["a", "b"])
  browser.close()
  assert.equal(browser.snapshot().open, false)
})

it("retains a failed page for retry, rejects repeated cursors and never publishes raw failures", async () => {
  const browser = new HistoryListController(() => {}, () => {})
  const context: HistoryListContext = { cwd: "/workspace", authorize: async () => {}, host: { readThread, async listThreads() { return { threads: [entry("a")], nextCursor: "cursor", total: 2 } } } }
  browser.bind(context)
  await browser.open()
  await browser.more()
  assert.ok(browser.snapshot().error)
  assert.deepEqual(browser.snapshot().entries.map((thread) => thread.id), ["a"])
  context.host.listThreads = async () => { throw new Error("secret credential /private/path") }
  await browser.refresh()
  assert.doesNotMatch(JSON.stringify(browser.snapshot()), /secret|private/)
  context.host.listThreads = async () => ({ threads: [entry("b")], nextCursor: null, total: 2 })
  await browser.more()
  assert.equal(browser.snapshot().error, null)
  assert.deepEqual(browser.snapshot().entries.map((thread) => thread.id), ["a", "b"])
})

it("ignores duplicate requests and responses from retired connections", async () => {
  const browser = new HistoryListController(() => {}, () => {})
  let resolve: (page: { threads: AppServerThreadSummary[]; nextCursor: null; total: number }) => void = () => {}
  let calls = 0
  browser.bind({ cwd: "/workspace", authorize: async () => {}, host: { readThread, listThreads() { calls++; return new Promise((done) => { resolve = done }) } } })
  const opening = browser.open()
  await new Promise((done) => setImmediate(done))
  await browser.refresh()
  assert.equal(calls, 1)
  browser.bind(null)
  resolve({ threads: [entry("late")], nextCursor: null, total: 1 })
  await opening
  assert.equal(browser.snapshot().loading, false)
  assert.equal(browser.snapshot().open, false)
  assert.deepEqual(browser.snapshot().entries, [])
})

it("does not list threads when authorization fails", async () => {
  const browser = new HistoryListController(() => {}, () => {})
  browser.bind({ cwd: "/workspace", authorize: async () => { throw new Error("denied") }, host: { readThread, async listThreads() { assert.fail("must not list") } } })
  await browser.open()
  assert.ok(browser.snapshot().error)
  assert.deepEqual(browser.snapshot().entries, [])
})
