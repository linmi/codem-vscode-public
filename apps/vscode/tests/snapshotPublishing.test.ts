import assert from "node:assert/strict"
import { it } from "node:test"
import type { ChatMessage, ChatSnapshot } from "../src/shared/messages.ts"
import { streamingConversation } from "./streamingScenario.ts"

/** Unchanged messages that a later snapshot carries as different objects: work spent re-copying old content. */
function recreated(previous: readonly ChatMessage[], next: readonly ChatMessage[]): number {
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
