import assert from "node:assert/strict"
import { it } from "node:test"
import { BackgroundTasks, type BackgroundContext, type BackgroundSnapshot } from "../src/chat/backgroundTasks.ts"

function fixture() {
  const snapshots: BackgroundSnapshot[] = []
  const notices: string[] = []
  const calls: string[] = []
  const background = new BackgroundTasks((state, notice) => { snapshots.push(state); if (notice) notices.push(notice) }, () => {}, () => {})
  const context: BackgroundContext = { cwd: "/workspace", threadId: "thread", host: {
    async listBackgroundTerminals() { calls.push("list"); return { cwd: "/workspace", terminals: [{ processId: 10, inProgress: true, logPath: "/private/log" }] } },
    async terminateBackgroundTerminal() { calls.push("terminate") },
    async cleanBackgroundTerminals() { calls.push("clean"); return { cwd: "/workspace", results: [] } },
    async cancelBackgroundTask() { calls.push("cancel"); return "cancelled" },
  } }
  return { background, context, snapshots, notices, calls }
}

it("keeps opaque handles stable, separates cancellation from termination and refreshes once per action", async () => {
  const f = fixture()
  await f.background.refresh(f.context)
  const id = f.background.snapshot().background[0]!.id
  await f.background.terminate(f.context, id)
  assert.equal(f.background.snapshot().background[0]!.id, id)
  f.background.wake({ type: "background-wake", threadId: "thread", turnId: "turn", taskId: "private-task", phase: "queued" })
  const task = f.background.snapshot().backgroundTasks[0]!
  await f.background.cancel(f.context, task.id)
  assert.equal(f.background.snapshot().backgroundTasks[0]!.phase, "cancelled")
  assert.deepEqual(f.calls, ["list", "terminate", "list", "cancel", "list"])
  assert.doesNotMatch(JSON.stringify(f.snapshots), /private|processId|taskId/)
  await f.background.terminate(f.context, "forged")
  assert.equal(f.calls.length, 5)
})

it("old refresh completion cannot release a new read or repopulate cleared handles, and reads never take the busy gate", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const f = fixture()
  const resolves: (() => void)[] = []
  f.context.host.listBackgroundTerminals = () => new Promise(resolve => { resolves.push(() => resolve({ cwd: "/workspace", terminals: [{ processId: 10, inProgress: true, logPath: "/private/log" }] })) })
  f.background.startPolling(() => f.context)
  const old = f.background.refresh(f.context)
  await Promise.resolve()
  f.background.clear()
  const next = f.background.refresh(f.context)
  await Promise.resolve()
  assert.equal(resolves.length, 2)
  resolves[0]!(); await old
  assert.deepEqual(f.background.snapshot().background, [])
  t.mock.timers.tick(3000); await Promise.resolve()
  assert.equal(resolves.length, 2, "the old read cannot release the new context's read, so the poll still waits")
  resolves[1]!(); await next
  f.background.stopPolling()
  assert.equal(f.background.snapshot().background.length, 1)
  assert.ok(f.snapshots.every(snapshot => !snapshot.backgroundBusy))
})

it("polling never toggles the busy gate and publishes only a changed list", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const f = fixture()
  const flush = async () => { for (let index = 0; index < 5; index++) await Promise.resolve() }
  f.background.startPolling(() => f.context)
  for (let tick = 0; tick < 4; tick++) { t.mock.timers.tick(3000); await flush() }
  assert.deepEqual(f.calls, ["list", "list", "list", "list"])
  assert.equal(f.snapshots.length, 1, "only the first poll changed the list")
  assert.ok(f.snapshots.every(snapshot => !snapshot.backgroundBusy))
  let pending!: () => void
  f.context.host.listBackgroundTerminals = () => new Promise(resolve => { f.calls.push("list"); pending = () => resolve({ cwd: "/workspace", terminals: [] }) })
  t.mock.timers.tick(3000); await flush()
  t.mock.timers.tick(3000); await flush()
  assert.equal(f.calls.length, 5, "a slow poll is not overlapped by the next tick")
  pending(); await flush()
  assert.equal(f.background.snapshot().background.length, 0)
  assert.equal(f.snapshots.length, 2)
  assert.equal(f.notices.length, 0)
  f.background.stopPolling()
})

it("a poll that returns after a user mutation is dropped; only the mutation holds busy", async () => {
  const f = fixture()
  await f.background.refresh(f.context)
  const id = f.background.snapshot().background[0]!.id
  const lists: ((terminals: { processId: number; inProgress: boolean; logPath: string }[]) => void)[] = []
  f.context.host.listBackgroundTerminals = () => new Promise(resolve => { f.calls.push("list"); lists.push(terminals => resolve({ cwd: "/workspace", terminals })) })
  const before = f.snapshots.length
  const poll = f.background.refresh(f.context)
  const terminating = f.background.terminate(f.context, id)
  await Promise.resolve(); await Promise.resolve()
  assert.equal(f.background.snapshot().backgroundBusy, true)
  assert.equal(lists.length, 2)
  lists[1]!([{ processId: 10, inProgress: false, logPath: "/private/log" }]); await terminating
  lists[0]!([{ processId: 10, inProgress: true, logPath: "/private/log" }]); await poll
  assert.equal(f.background.snapshot().background[0]!.inProgress, false, "the stale poll result is dropped")
  assert.equal(f.background.snapshot().background[0]!.id, id)
  assert.deepEqual(f.snapshots.slice(before).map(snapshot => snapshot.backgroundBusy), [true, true, false])
  assert.deepEqual(f.calls.slice(1), ["list", "terminate", "list"])
})

it("a manual refresh during a slow poll reads again, wins over the poll and reports its own failure", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const f = fixture()
  const flush = async () => { for (let index = 0; index < 5; index++) await Promise.resolve() }
  const lists: { resolve: (terminals: { processId: number; inProgress: boolean; logPath: string }[]) => void; reject: (error: Error) => void }[] = []
  f.context.host.listBackgroundTerminals = () => new Promise((resolve, reject) => { f.calls.push("list"); lists.push({ resolve: terminals => resolve({ cwd: "/workspace", terminals }), reject }) })
  f.background.startPolling(() => f.context)
  t.mock.timers.tick(3000); await flush()
  const refreshed = f.background.refresh(f.context)
  await flush()
  assert.equal(lists.length, 2, "the click is not dropped behind the poll")
  lists[1]!.resolve([{ processId: 11, inProgress: false, logPath: "/private/new" }]); await refreshed
  lists[0]!.resolve([{ processId: 10, inProgress: true, logPath: "/private/old" }]); await flush()
  assert.deepEqual(f.background.snapshot().background.map(item => item.inProgress), [false], "the older poll result is dropped")
  const failed = f.background.refresh(f.context)
  await flush()
  lists[2]!.reject(new Error("list failed")); await failed
  assert.deepEqual(f.notices, ["后台列表刷新失败，请稍后重试。"])
  assert.ok(f.snapshots.every(snapshot => !snapshot.backgroundBusy))
  f.background.stopPolling()
})

it("failed actions release exclusion and can be retried without automatic mutation retries", async () => {
  const f = fixture()
  await f.background.refresh(f.context)
  const id = f.background.snapshot().background[0]!.id
  let attempts = 0
  f.context.host.terminateBackgroundTerminal = async () => { attempts++; throw new Error("failure") }
  await f.background.terminate(f.context, id)
  assert.equal(attempts, 1)
  assert.equal(f.background.snapshot().backgroundBusy, false)
  assert.equal(f.notices.length, 1)
  await f.background.refresh(f.context)
  assert.equal(f.background.snapshot().background.length, 1)
})

it("polling replacement and shutdown leave no timer that can issue further RPCs", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] })
  const f = fixture()
  f.background.startPolling(() => f.context)
  f.background.startPolling(() => f.context)
  t.mock.timers.tick(3000)
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(f.calls.length, 1)
  f.background.stopPolling()
  f.background.clear()
  t.mock.timers.tick(9000)
  assert.equal(f.calls.length, 1)
})
