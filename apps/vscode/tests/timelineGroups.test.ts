import assert from "node:assert/strict"
import { it } from "node:test"
import { timelineGroups } from "../src/timelineGroups.ts"
import type { ChatMessage } from "../src/messages.ts"
const user = (id: string): ChatMessage => ({ id, role: "user", label: "你", text: "问题" })
const answer = (id: string): ChatMessage => ({ id, role: "assistant", label: "CodeM", text: id })
const tool = (id: string): ChatMessage => ({ id, role: "tool", label: "搜索", text: "结果", summary: "", status: "completed" })
it("groups interleaved progress and tools once, retaining only the trailing reply outside", () => {
  const groups = timelineGroups([user("u"), tool("t1"), answer("progress1"), tool("t2"), answer("progress2"), tool("t3"), answer("final")])
  assert.equal(groups.length, 3)
  const work = groups[1]!
  assert.equal(work.kind, "work")
  if (work.kind === "work") assert.deepEqual(work.messages.map(m => m.id), ["t1", "progress1", "t2", "progress2", "t3"])
  assert.deepEqual(groups[2], { kind: "message", message: answer("final") })
})
it("keeps user responses separate and does not fabricate a final reply after a tool", () => {
  const groups = timelineGroups([user("u1"), tool("t1"), answer("a1"), user("u2"), answer("progress"), tool("t2")])
  assert.equal(groups.filter(g => g.kind === "work").length, 2)
  assert.equal(groups.at(-1)?.kind, "work")
  assert.deepEqual(timelineGroups([user("u"), answer("plain")]), [{ kind: "message", message: user("u") }, { kind: "message", message: answer("plain") }])
})
