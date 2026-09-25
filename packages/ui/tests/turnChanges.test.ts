import assert from "node:assert/strict"
import { it } from "node:test"
import { turnChanges } from "../src/chat/turnChanges.ts"
import type { ChatMessage, DiffView } from "../src/contract.ts"
const diff = (id: string, turnId: string): DiffView => ({ id, turnId, label: "src/main.ts", added: 2, removed: 1, preview: "partial", available: true })
const message = (id: string, turnId: string, role: "assistant" | "user" = "assistant"): ChatMessage => ({ id, turnId, role, text: id, label: "CodeM" })
it("anchors each turn's changes after its last message without moving them into a later turn", () => {
  const messages = [message("u1", "t1", "user"), message("progress", "t1"), message("final", "t1"), message("u2", "t2", "user"), message("a2", "t2")]
  const groups = turnChanges(messages, [diff("one", "t1"), diff("two", "t2"), diff("three", "t1")])
  assert.deepEqual(groups.map(group => [group.turnId, group.afterMessageId, group.files.map(file => file.id)]), [["t1", "final", ["one", "three"]], ["t2", "a2", ["two"]]])
  assert.equal(groups[0]!.files.length, 2, "Repeated file edits retain independent previews, never a fabricated net diff")
})
it("keeps changes on interrupted turns without a final answer; terminal replies move only the anchor", () => {
  const messages: ChatMessage[] = [message("u", "t", "user"), { id: "tool", turnId: "t", role: "tool", label: "edit", text: "", status: "interrupted", summary: "" }]
  assert.equal(turnChanges(messages, [diff("one", "t")])[0]!.afterMessageId, "tool")
  assert.equal(turnChanges([...messages, message("final", "t")], [diff("one", "t")])[0]!.afterMessageId, "final")
  assert.deepEqual(turnChanges(messages, []), [])
  assert.equal(turnChanges([], [{ ...diff("one", "t"), available: false }])[0]!.files[0]!.available, false)
  assert.deepEqual(turnChanges(messages, [{ ...diff("orphan", "t"), turnId: undefined }]), [], "A diff without a Core turn is never assigned to a turn")
})
