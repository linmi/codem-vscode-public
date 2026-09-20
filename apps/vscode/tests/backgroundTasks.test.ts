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

it("old refresh completion cannot release a new operation lock or repopulate cleared handles", async () => {
  const f = fixture()
  const resolves: (() => void)[] = []
  f.context.host.listBackgroundTerminals = () => new Promise(resolve => { resolves.push(() => resolve({ cwd: "/workspace", terminals: [{ processId: 10, inProgress: true, logPath: "/private/log" }] })) })
  const old = f.background.refresh(f.context)
  await Promise.resolve()
  await f.background.refresh(f.context)
  assert.equal(resolves.length, 1)
  f.background.clear()
  const next = f.background.refresh(f.context)
  await Promise.resolve()
  resolves[0]!(); await old
  assert.equal(f.background.snapshot().backgroundBusy, true)
  assert.deepEqual(f.background.snapshot().background, [])
  resolves[1]!(); await next
  assert.equal(f.background.snapshot().backgroundBusy, false)
  assert.equal(f.background.snapshot().background.length, 1)
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
