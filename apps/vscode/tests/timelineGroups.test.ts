import assert from "node:assert/strict"
import { it } from "node:test"
import { timelineGroups } from "../src/shared/timelineGroups.ts"
import type { ChatMessage } from "../src/shared/messages.ts"
const user = (id: string): ChatMessage => ({ id, role: "user", label: "你", text: "问题" })
const answer = (id: string): ChatMessage => ({ id, role: "assistant", label: "CodeM", text: id })
const tool = (id: string): ChatMessage => ({ id, role: "tool", label: "搜索", text: "结果", summary: "", status: "completed" })
it("folds only adjacent tools and reasoning while keeping every body in chronological order", () => {
  const reasoning: ChatMessage = { id: "r", role: "reasoning", label: "思考过程", text: "分析", summary: "", status: "completed" }
  const messages = [user("u"), reasoning, tool("t1"), answer("progress1"), tool("t2"), answer("progress2"), tool("t3"), answer("overview"), answer("followup")]
  const groups = timelineGroups(messages)
  assert.deepEqual(groups.map(group => group.kind === "message" ? group.message.id : group.messages.map(message => message.id)), ["u", ["r", "t1"], "progress1", ["t2"], "progress2", ["t3"], "overview", "followup"])
  assert.deepEqual(groups.flatMap<ChatMessage>(group => group.kind === "message" ? [group.message] : group.messages), messages)
  assert.equal(groups.flatMap(group => group.kind === "work" ? group.messages : []).some(message => String(message.role) === "assistant"), false, "No earlier answer or progress text may be folded")
})
it("does not move streaming text into a disclosure when a later tool or reply arrives", () => {
  const initial = [user("u"), tool("t1"), answer("streaming")]
  const before = timelineGroups(initial)
  const after = timelineGroups([...initial, tool("t2"), answer("final")])
  assert.deepEqual(after.slice(0, before.length), before)
  assert.deepEqual(timelineGroups([user("u"), answer("plain")]), [{ kind: "message", message: user("u") }, { kind: "message", message: answer("plain") }])
  assert.deepEqual(timelineGroups([]), [])
})
it("keeps turn boundaries, failures and trailing tools without inventing a final answer", () => {
  const messages: ChatMessage[] = [user("u1"), tool("t1"), answer("a1"), user("u2"), answer("progress"), { ...tool("t2"), turnId: "turn2" }, { ...tool("t3"), turnId: "backgroundTurn" }]
  const groups = timelineGroups(messages)
  assert.equal(groups.filter(group => group.kind === "work").length, 3)
  assert.equal(groups.at(-1)?.kind, "work")
  const failed: ChatMessage = { id: "failed", role: "tool", label: "执行", text: "失败", summary: "", status: "failed" }
  assert.deepEqual(timelineGroups([failed, answer("explanation")]), [{ kind: "work", id: "failed", messages: [failed] }, { kind: "message", message: answer("explanation") }])
})
