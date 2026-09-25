import assert from "node:assert/strict"
import { it } from "node:test"
import type { ChatSnapshot as UiSnapshot } from "@codem/ui/contract"
import type { ChatMessage, ChatSnapshot } from "../src/shared/messages.ts"
import { VscodeHostBridge } from "../webview/host/vscodeHostBridge.ts"
import { streamingConversation } from "./streamingScenario.ts"

/** Unchanged messages that a later snapshot carries as different objects: work spent re-copying old content. */
function recreated(previous: readonly { id: string; text: string }[], next: readonly { id: string; text: string }[]): number {
  const before = new Map(previous.map(message => [message.id, message]))
  return next.filter(message => before.has(message.id) && before.get(message.id)!.text === message.text && before.get(message.id) !== message).length
}

/** Whole-state clones and re-created unchanged messages per streaming delta. */
async function hostWork(messageCount: number, deltas = 20) {
  const published: ChatSnapshot[] = []
  const conversation = await streamingConversation(messageCount, state => published.push(state))
  const clone = globalThis.structuredClone
  let clones = 0
  globalThis.structuredClone = ((value: unknown, options?: Parameters<typeof structuredClone>[1]) => { clones++; return clone(value, options) }) as typeof structuredClone
  try { for (let index = 0; index < deltas; index++) conversation.stream("增量") }
  finally { globalThis.structuredClone = clone }
  await conversation.controller.dispose()
  assert.equal(published.length, deltas, "Each delta publishes once")
  let copies = 0
  for (let index = 1; index < published.length; index++) copies += recreated(published[index - 1]!.messages, published[index]!.messages)
  return { messages: published.at(-1)!.messages.length, clonesPerDelta: clones / deltas, recreatedPerDelta: copies / (published.length - 1) }
}

it("a streaming delta clones no state and re-creates no unchanged message, at any conversation size", async () => {
  const small = await hostWork(10), large = await hostWork(500)
  assert.equal(large.messages > 500, true)
  // Before: one structuredClone of the whole state and every message re-created, per delta.
  assert.deepEqual({ clones: small.clonesPerDelta, recreated: small.recreatedPerDelta }, { clones: 0, recreated: 0 })
  assert.deepEqual({ clones: large.clonesPerDelta, recreated: large.recreatedPerDelta }, { clones: 0, recreated: 0 })
})

it("published snapshots are frozen and keep what they showed after later deltas", async t => {
  const published: ChatSnapshot[] = []
  const conversation = await streamingConversation(5, state => published.push(state))
  t.after(() => conversation.controller.dispose())
  conversation.stream("第一段")
  conversation.stream("第二段")
  const [first, second] = published as [ChatSnapshot, ChatSnapshot]
  for (const value of [first, first.messages, first.messages.at(-1), first.capabilities, first.sessionTools, first.history, first.history.entries, first.composerCatalog, first.composerCatalog.models]) {
    assert.equal(Object.isFrozen(value), true)
  }
  assert.throws(() => { (first.messages as ChatMessage[]).push({ id: "rogue", role: "user", label: "你", text: "rogue" }) }, TypeError)
  assert.throws(() => { (first.messages.at(-1) as { text: string }).text = "rogue" }, TypeError)
  assert.equal(first.messages.at(-1)?.text, "第一段")
  assert.equal(second.messages.at(-1)?.text, "第一段第二段")
  assert.equal(second.messages.at(-2), first.messages.at(-2), "Unchanged messages are shared, not copied")
  assert.equal(second.history, first.history, "An unchanged history list is shared, not copied per publish")
  assert.equal(second.capabilities, first.capabilities)
  assert.equal(conversation.controller.snapshot().messages.at(-1)?.text, "第一段第二段")
})

it("reading the phase or thread builds no snapshot; snapshots are built only to publish", async t => {
  let published = 0
  const conversation = await streamingConversation(50, () => { published++ })
  t.after(() => conversation.controller.dispose())
  const controller = conversation.controller
  conversation.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "completed", stopReason: "end", error: null })
  assert.deepEqual([controller.phase(), controller.currentThreadId()], [controller.snapshot().phase, controller.snapshot().threadId])
  assert.deepEqual([controller.phase(), controller.currentThreadId()], ["ready", "thread-1"])
  const build = controller.snapshot.bind(controller)
  let built = 0
  controller.snapshot = () => { built++; return build() }
  published = 0
  // Each of these ends by checking the phase it set; that check used to clone the whole state.
  await controller.addAttachments(async () => [])
  await controller.configure(async () => null)
  await controller.refreshSpaces()
  assert.equal(controller.phase(), "ready")
  assert.equal(published > 0, true)
  assert.equal(built, published, "Every snapshot built was published")
})

/** Bytes the Webview bridge serializes and unchanged messages it re-normalizes, per streaming state it receives. */
async function bridgeWork(messageCount: number, deltas = 20) {
  const wire = JSON.stringify.bind(JSON)
  const bridge = new VscodeHostBridge()
  const snapshots: UiSnapshot[] = []
  let serialized = 0
  const conversation = await streamingConversation(messageCount, state => {
    // postMessage hands the Webview a fresh copy; nothing survives by identity.
    const received: unknown = JSON.parse(wire(state))
    const stringify = JSON.stringify
    JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => { const text = stringify(...args); serialized += text?.length ?? 0; return text }) as typeof JSON.stringify
    try { snapshots.push(bridge.receive(received)!.snapshot) } finally { JSON.stringify = stringify }
  })
  bridge.receive(JSON.parse(wire(conversation.controller.snapshot())))
  for (let index = 0; index < deltas; index++) conversation.stream("增量")
  await conversation.controller.dispose()
  let copies = 0
  for (let index = 1; index < snapshots.length; index++) copies += recreated(snapshots[index - 1]!.messages, snapshots[index]!.messages)
  return { messages: snapshots.at(-1)!.messages.length, serializedPerDelta: serialized / deltas, renormalizedPerDelta: copies / (snapshots.length - 1), versions: snapshots.map(snapshot => snapshot.version) }
}

it("the Webview bridge serializes nothing per delta and re-normalizes only the changed message, at any conversation size", async () => {
  const small = await bridgeWork(10), large = await bridgeWork(500)
  assert.equal(large.messages > 500, true)
  // Before: a JSON signature of the whole state and every message re-normalized, per state received.
  assert.equal(large.serializedPerDelta, small.serializedPerDelta, "Serialized bytes do not grow with the conversation")
  assert.equal(large.serializedPerDelta < 256, true)
  assert.deepEqual([small.renormalizedPerDelta, large.renormalizedPerDelta], [0, 0])
  for (const { versions } of [small, large]) assert.deepEqual(versions.slice(1).map((version, index) => version - versions[index]!), versions.slice(1).map(() => 1))
})

it("the Webview bridge reuses unchanged projections without changing what it publishes", () => {
  const bridge = new VscodeHostBridge()
  const state = (messages: readonly Record<string, unknown>[], notice: string | null = null) => structuredClone({ type: "state", phase: "running", workspace: "/Users/linmi/secret/codem-plugin", threadId: "thread-1", notice, messages })
  const reply = { id: "turn-1:reply", role: "assistant", label: "CodeM", text: "第一段", turnId: "turn-1" }
  const tool = { id: "turn-1:tool:1", role: "tool", label: "执行命令", text: "", summary: "", status: "running", turnId: "turn-1", details: { kind: "command", fields: [{ label: "命令", value: "pnpm test" }], code: null } }
  const unknown = { id: "turn-1:other", role: "system", label: "内部", text: "不展示" }
  const status = { id: "turn-1:status", role: "turnStatus", label: "已停止", text: "已停止", turnId: "turn-1", outcome: "stopped" }
  const steps = [
    state([reply, tool, unknown, status]),
    state([reply, tool, unknown, status]),
    state([reply, { ...tool, status: "completed", text: "ok" }, unknown, status]),
    state([reply, { ...tool, status: "completed", text: "ok" }, unknown, status], "提示"),
    state([{ ...reply, text: "第一段第二段" }, { ...tool, status: "completed", text: "ok" }, unknown, status, { id: "turn-2:reply", role: "assistant", label: "CodeM", text: "新回复" }]),
    state([]),
  ]
  const published = steps.map(step => bridge.receive(step)!.snapshot)
  // Each projection equals what a fresh bridge makes of the same state, apart from its own version count.
  steps.forEach((step, index) => assert.deepEqual({ ...published[index]!, version: 0 }, { ...new VscodeHostBridge().receive(step)!.snapshot, version: 0 }))
  const [first, same, completed, noticed, streamed, cleared] = published as [UiSnapshot, UiSnapshot, UiSnapshot, UiSnapshot, UiSnapshot, UiSnapshot]
  assert.equal(first.messages.length, 3, "An unknown role is still dropped")
  assert.equal(same.version, first.version, "An identical state keeps its version")
  assert.equal(bridge.snapshot().version, cleared.version, "Re-projecting without a change keeps the version")
  first.messages.forEach((message, index) => assert.equal(same.messages[index], message))
  assert.equal(completed.version, first.version + 1)
  assert.equal(completed.messages[0], first.messages[0])
  assert.equal(completed.messages[2], first.messages[2])
  assert.equal(completed.messages[1]?.status, "completed")
  assert.equal(noticed.version, completed.version + 1)
  completed.messages.forEach((message, index) => assert.equal(noticed.messages[index], message))
  assert.equal(streamed.messages[0]?.text, "第一段第二段")
  assert.equal(streamed.messages[1], completed.messages[1])
  assert.equal(streamed.messages.at(-1)?.text, "新回复")
  assert.deepEqual([cleared.messages.length, cleared.version], [0, streamed.version + 1])
  assert.equal(Object.isFrozen(streamed.messages[1]) && Object.isFrozen(streamed.messages[1]?.details?.fields), true, "Shared projections are frozen")
  assert.equal(JSON.stringify(published).includes("/Users/linmi/secret"), false)
})
