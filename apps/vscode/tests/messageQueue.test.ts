import assert from "node:assert/strict"
import { it } from "node:test"
import { capabilityFixture } from "./capabilityFixtures.ts"
import { MAX_QUEUED_MESSAGES, MessageQueue } from "../src/chat/messageQueue.ts"
import { parseViewAction } from "../src/shared/messages.ts"

/** Records the text of every turn the controller starts. */
function queueFixture() {
  const f = capabilityFixture()
  const turns: string[] = []
  const startTurn = f.host.startTurn.bind(f.host)
  f.host.startTurn = async input => { turns.push(input.text); assert.deepEqual(input.attachments, []); return await startTurn(input) }
  const queued = () => f.controller.snapshot().messageQueue
  const settle = () => new Promise<void>(resolve => setImmediate(resolve))
  return { ...f, turns, queued, settle }
}

it("keeps queued text for one thread, bounded, editable and removable", () => {
  const queue = new MessageQueue()
  assert.equal(queue.add("thread-1", "  "), false)
  for (let index = 0; index < MAX_QUEUED_MESSAGES; index++) assert.equal(queue.add("thread-1", `m${index}`), true)
  assert.equal(queue.add("thread-1", "overflow"), false)
  const [first, second] = queue.view("thread-1").items
  assert.equal(queue.edit(first!.id, "edited"), true)
  assert.equal(queue.edit(first!.id, " "), false)
  assert.equal(queue.edit("missing", "x"), false)
  assert.equal(queue.remove(second!.id), true)
  assert.equal(queue.remove(second!.id), false)
  assert.equal(queue.view("thread-2").items.length, 0, "Another thread never sees this queue")
  assert.equal(queue.next("thread-2"), null)
  queue.pause()
  assert.equal(queue.next("thread-1"), null, "A paused queue dispatches nothing")
  queue.resume()
  const head = queue.next("thread-1")!
  assert.equal(head.text, "edited")
  queue.restore("thread-1", head)
  assert.deepEqual(queue.view("thread-1"), { items: queue.view("thread-1").items, paused: true })
  assert.equal(queue.view("thread-1").items[0]!.id, head.id, "A refused dispatch goes back to the head")
  queue.follow("thread-2")
  assert.deepEqual(queue.view("thread-2"), { items: [], paused: false })
  assert.deepEqual(queue.view("thread-1"), { items: [], paused: false }, "Following another thread drops the old queue")
})

it("sends queued messages in order after each completed turn, with edits applied and removals skipped", async t => {
  const f = queueFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first")
  assert.equal(f.controller.snapshot().phase, "running")
  f.controller.queueMessage("thread-1", "second", "q1")
  f.controller.queueMessage("thread-1", "dropped", "q2")
  f.controller.queueMessage("thread-1", "third", "q3")
  assert.deepEqual(f.controller.snapshot().sessionTools.result, { requestId: "q3", accepted: true })
  const [second, dropped] = f.queued().items
  f.controller.editQueuedMessage(second!.id, "second, edited")
  f.controller.removeQueuedMessage(dropped!.id)
  assert.deepEqual(f.queued().items.map(item => item.text), ["second, edited", "third"])
  f.finish(); await f.settle()
  assert.deepEqual(f.turns, ["first", "second, edited"])
  assert.equal(f.controller.snapshot().phase, "running")
  assert.deepEqual(f.queued().items.map(item => item.text), ["third"])
  f.finish(); await f.settle()
  f.finish(); await f.settle()
  assert.deepEqual(f.turns, ["first", "second, edited", "third"])
  assert.equal(f.controller.snapshot().phase, "ready")
  assert.deepEqual(f.queued(), { items: [], paused: false })
  assert.equal(f.controller.snapshot().messages.filter(message => message.role === "user").length, 3)
})

it("never sends the queue on its own after a stopped or failed turn", async t => {
  for (const outcome of ["stopped", "failed"] as const) {
    const f = queueFixture(); t.after(() => f.controller.dispose())
    await f.controller.connect(); await f.controller.send("first")
    f.controller.queueMessage("thread-1", "later", "q1")
    f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome, stopReason: outcome, error: null })
    await f.settle()
    assert.deepEqual(f.turns, ["first"], `${outcome}: nothing was sent`)
    assert.equal(f.controller.snapshot().phase, "ready")
    assert.equal(f.queued().paused, true)
    assert.deepEqual(f.queued().items.map(item => item.text), ["later"])
    // A later completed turn does not quietly resume the queue either.
    await f.controller.send("typed")
    f.finish(); await f.settle()
    assert.deepEqual(f.turns, ["first", "typed"], `${outcome}: still waiting for the user`)
    await f.controller.resumeQueue(); await f.settle()
    assert.deepEqual(f.turns, ["first", "typed", "later"], `${outcome}: the user sent it on`)
    assert.deepEqual(f.queued(), { items: [], paused: false })
  }
})

it("refuses queueing while idle or for another thread, and drops the queue with its thread", async t => {
  const f = queueFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first"); f.finish()
  f.controller.queueMessage("thread-1", "idle", "q1")
  assert.deepEqual(f.controller.snapshot().sessionTools.result, { requestId: "q1", accepted: false })
  await f.controller.send("second")
  f.controller.queueMessage("thread-0", "stale", "q2")
  assert.deepEqual(f.controller.snapshot().sessionTools.result, { requestId: "q2", accepted: false })
  f.controller.queueMessage("thread-1", "kept until the thread closes", "q3")
  assert.equal(f.queued().items.length, 1)
  f.emit({ type: "thread-closed", cwd: "/workspace", threadId: "thread-1", reason: "archived" })
  assert.deepEqual(f.queued(), { items: [], paused: false })
  await f.settle()
  assert.deepEqual(f.turns, ["first", "second"])
})

it("puts a queued message Core did not accept back at the head, paused, without retrying", async t => {
  const f = queueFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first")
  f.controller.queueMessage("thread-1", "refused", "q1")
  f.controller.queueMessage("thread-1", "after", "q2")
  let attempts = 0
  f.host.startTurn = async () => { attempts++; throw new Error("secret detail") }
  f.finish(); await f.settle(); await f.settle()
  assert.equal(attempts, 1)
  assert.equal(f.controller.snapshot().phase, "ready")
  assert.equal(f.queued().paused, true)
  assert.deepEqual(f.queued().items.map(item => item.text), ["refused", "after"])
  assert.ok(f.controller.snapshot().notice)
  assert.doesNotMatch(JSON.stringify(f.controller.snapshot()), /secret detail/)
})

it("parses queue actions with opaque ids and bounded text only", () => {
  assert.deepEqual(parseViewAction({ type: "queueMessage", threadId: "thread-1", text: "next", requestId: "r1" }), { type: "queueMessage", threadId: "thread-1", text: "next", requestId: "r1" })
  assert.deepEqual(parseViewAction({ type: "editQueuedMessage", id: "q-1", text: "changed" }), { type: "editQueuedMessage", id: "q-1", text: "changed" })
  assert.deepEqual(parseViewAction({ type: "removeQueuedMessage", id: "q-1" }), { type: "removeQueuedMessage", id: "q-1" })
  assert.deepEqual(parseViewAction({ type: "resumeQueue" }), { type: "resumeQueue" })
  for (const bad of [
    { type: "queueMessage", text: "next", requestId: "r1" },
    { type: "editQueuedMessage", id: "q-1", text: " " },
    { type: "editQueuedMessage", id: "/q", text: "x" },
    { type: "editQueuedMessage", id: "q-1", text: "x".repeat(32_001) },
    { type: "removeQueuedMessage" },
  ]) assert.throws(() => parseViewAction(bad), JSON.stringify(bad).slice(0, 80))
})

it("drops a paused queue when the user starts a new chat", async t => {
  const f = queueFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first")
  f.controller.queueMessage("thread-1", "later", "q1")
  f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "stopped", stopReason: "stopped", error: null })
  assert.equal(f.queued().items.length, 1)
  await f.controller.newChat()
  assert.equal(f.controller.snapshot().threadId, null)
  assert.deepEqual(f.queued(), { items: [], paused: false })
  await f.controller.resumeQueue(); await f.settle()
  assert.deepEqual(f.turns, ["first"])
})
