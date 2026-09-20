import assert from "node:assert/strict"
import { it } from "node:test"
import type { AppServerLiveTurn } from "@codem/app-server"
import { LiveSnapshotCatalog } from "../src/chat/liveSnapshotCatalog.ts"
import type { LiveCatalogView } from "../src/shared/capabilityTypes.ts"
import { parseViewAction } from "../src/shared/messages.ts"
import { capabilityFixture } from "./capabilityFixtures.ts"

const turn = (id: string): AppServerLiveTurn => ({ id, status: "completed", startedAt: null })
const item = (id: string) => ({ id, type: "steerAccepted" as const, status: "completed" as const, mode: "followUp", recordSeq: 1, text: "private content" })
function fixture() {
  let view: LiveCatalogView
  let trusted = true
  const calls: string[] = []
  const host = {
    async listLoadedThreadIds() { calls.push("loaded"); return { threadIds: ["thread"] } },
    async listLiveThreadTurns(_cwd: string, _thread: string, cursor?: number) { calls.push(`turns:${cursor ?? "first"}`); return { entries: [turn(cursor ? "second" : "first")], nextCursor: cursor ? null : 1, total: 2 } },
    async listLiveThreadItems(_cwd: string, _thread: string, cursor?: number) { calls.push(`items:${cursor ?? "first"}`); return { entries: [item(cursor ? "second-item" : "first-item")], nextCursor: cursor ? null : 1, total: 2 } },
  }
  const context = { host, cwd: "/workspace", threadId: "thread" as string | null, authorize: async () => { calls.push("authorize") } }
  const catalog = new LiveSnapshotCatalog(next => { view = next }, () => { if (!trusted) throw Error("Untrusted") }, () => {})
  return { catalog, context, host, calls, view: () => view, untrust: () => { trusted = false } }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

it("paginates turns and items independently, authorizes once per request and exposes no Core cursor or contents", async () => {
  const f = fixture()
  await f.catalog.refresh(f.context)
  assert.deepEqual(f.calls, ["authorize", "loaded", "turns:first", "items:first"])
  const initial = f.view().snapshotId
  await f.catalog.more("forged", "turns")
  assert.equal(f.calls.length, 4)
  await f.catalog.more(initial, "turns")
  assert.deepEqual(f.calls.slice(4), ["authorize", "turns:1"])
  assert.equal(f.view().pages!.turns.rows.length, 2)
  assert.equal(f.view().pages!.turns.hasMore, false)
  assert.equal(f.view().pages!.items.rows.length, 1)
  await f.catalog.more(initial, "items") // Old buttons cannot consume another stream's page.
  assert.equal(f.calls.length, 6)
  await f.catalog.more(f.view().snapshotId, "items")
  assert.deepEqual(f.calls.slice(6), ["authorize", "items:1"])
  assert.equal(f.view().pages!.items.rows.length, 2)
  assert.doesNotMatch(JSON.stringify(f.view()), /nextCursor|private content|\/workspace/)
  await f.catalog.more(f.view().snapshotId, "items")
  assert.equal(f.calls.length, 8)
})

it("keeps the same page available after RPC failure and suppresses concurrent double clicks", async () => {
  const f = fixture(); await f.catalog.refresh(f.context)
  const read = f.host.listLiveThreadTurns
  let release!: () => void
  f.host.listLiveThreadTurns = async () => { await new Promise<void>(resolve => { release = resolve }); throw Error("sensitive RPC failure") }
  const id = f.view().snapshotId, pending = f.catalog.more(id, "turns")
  await tick()
  assert.equal(f.view().loading, "turns")
  await f.catalog.more(id, "items")
  await f.catalog.refresh(f.context)
  assert.equal(f.calls.filter(call => call === "authorize").length, 2)
  release(); await pending
  assert.equal(f.view().pages!.turns.rows.length, 1)
  assert.equal(f.view().stale, false)
  assert.equal(f.view().loading, null)
  assert.match(f.view().error!, /重试/)
  assert.doesNotMatch(JSON.stringify(f.view()), /sensitive/)
  f.host.listLiveThreadTurns = read
  await f.catalog.more(id, "turns")
  assert.equal(f.view().pages!.turns.rows.length, 2)
  assert.equal(f.view().error, null)
})

it("rejects overlapping pages, changing totals and non-advancing cursors without partially appending", async () => {
  for (const invalid of [
    { entries: [turn("first")], total: 2, nextCursor: null },
    { entries: [turn("second")], total: 3, nextCursor: null },
    { entries: [turn("second")], total: 2, nextCursor: 1 },
    { entries: [], total: 2, nextCursor: 2 },
  ]) {
    const f = fixture(); await f.catalog.refresh(f.context)
    f.host.listLiveThreadTurns = async () => invalid
    await f.catalog.more(f.view().snapshotId, "turns")
    assert.equal(f.view().stale, true)
    assert.equal(f.view().pages!.turns.rows.length, 1)
    const count = f.calls.length
    await f.catalog.more(f.view().snapshotId, "items")
    assert.equal(f.calls.length, count)
  }
})

it("cancellation, invalidation and reset discard pending responses; cancellation can retry", async () => {
  for (const action of ["cancel", "invalidate", "clear"] as const) {
    const f = fixture(); await f.catalog.refresh(f.context)
    const read = f.host.listLiveThreadItems
    let release!: () => void
    f.host.listLiveThreadItems = async (...args) => { await new Promise<void>(resolve => { release = resolve }); return read(...args) }
    const pending = f.catalog.more(f.view().snapshotId, "items")
    await tick()
    if (action === "cancel") f.catalog.cancel(f.view().snapshotId)
    else f.catalog[action]()
    const before = structuredClone(f.view())
    release(); await pending
    assert.deepEqual(f.view(), before)
    f.host.listLiveThreadItems = read
    if (action === "cancel") {
      await f.catalog.more(f.view().snapshotId, "items")
      assert.equal(f.view().pages!.items.rows.length, 2)
    } else {
      await f.catalog.refresh(f.context)
      assert.equal(f.view().stale, false)
      assert.equal(f.view().pages!.items.rows.length, 1)
    }
  }
})

it("trust loss and cancellation during authorization never start snapshot RPCs", async () => {
  const f = fixture()
  let release!: () => void
  f.context.authorize = () => new Promise<void>(resolve => { release = resolve })
  const pending = f.catalog.refresh(f.context)
  assert.equal(f.view().pages, null)
  f.catalog.cancel(f.view().snapshotId); release(); await pending
  assert.deepEqual(f.calls, [])
  f.context.authorize = async () => { f.untrust() }
  await f.catalog.refresh(f.context)
  assert.deepEqual(f.calls, [])
  assert.equal(f.view().loaded, false)
  assert.ok(f.view().error)
})

it("empty threads and no active thread do not fabricate pagination", async () => {
  const f = fixture(); f.context.threadId = null
  await f.catalog.refresh(f.context)
  assert.deepEqual(f.calls, ["authorize", "loaded"])
  assert.equal(f.view().pages, null)
  f.context.threadId = "new"
  f.host.listLiveThreadTurns = async () => ({ entries: [], nextCursor: null, total: 0 })
  f.host.listLiveThreadItems = async () => ({ entries: [], nextCursor: null, total: 0 })
  await f.catalog.refresh(f.context)
  assert.deepEqual(f.view().pages!.turns, { rows: [], total: 0, hasMore: false })
})

it("only bound pagination intents are accepted, never cursors or arbitrary paths", () => {
  assert.equal(parseViewAction({ type: "loadMoreLiveSnapshot", snapshotId: "snapshot-1", kind: "turns" }).type, "loadMoreLiveSnapshot")
  assert.equal(parseViewAction({ type: "cancelLiveSnapshot", snapshotId: "snapshot-1" }).type, "cancelLiveSnapshot")
  for (const extra of [{ cursor: "x" }, { cwd: "/tmp" }, { threadId: "x" }, { kind: "history" }, { snapshotId: "" }]) {
    assert.throws(() => parseViewAction({ type: "loadMoreLiveSnapshot", snapshotId: "snapshot-1", kind: "items", ...extra }))
  }
})

it("controller invalidates current snapshot on turn events and drops pages across catalog/context switches", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  const source = fixture()
  Object.assign(f.host, source.host)
  await f.controller.connect(); await f.controller.send("first"); f.finish()
  await f.controller.loadCatalog("live")
  const live = () => { const view = f.controller.snapshot().sessionTools.catalog; assert.equal(view?.kind, "live"); return view as LiveCatalogView }
  assert.equal(live().pages!.turns.rows.length, 1)
  const id = live().snapshotId
  f.emit({ type: "turn-started", threadId: "foreign", turnId: "foreign", submissionId: null })
  assert.equal(live().stale, false)
  await f.controller.send("second")
  assert.equal(live().stale, true)
  const calls = source.calls.length
  await f.controller.loadMoreLiveSnapshot(id, "turns")
  assert.equal(source.calls.length, calls)
  f.finish()
  await f.controller.loadCatalog("live")
  await f.controller.loadMoreLiveSnapshot(live().snapshotId, "turns")
  assert.equal(live().pages!.turns.rows.length, 2)
  f.host.listSkills = async () => []
  await f.controller.loadCatalog("skills")
  await f.controller.loadMoreLiveSnapshot(id, "items")
  assert.equal(f.controller.snapshot().sessionTools.catalog?.kind, "skills")
  await f.controller.loadCatalog("live")
  await f.controller.newChat()
  assert.equal(f.controller.snapshot().sessionTools.catalog, null)
  await f.controller.loadMoreLiveSnapshot(id, "items")
  assert.equal(f.controller.snapshot().sessionTools.catalog, null)
})
