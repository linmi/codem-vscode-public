import assert from "node:assert/strict"
import { it } from "node:test"
import { timelineGroups } from "../src/shared/timelineGroups.ts"
import type { ChatMessage } from "../src/shared/messages.ts"
const user = (id: string): ChatMessage => ({ id, role: "user", label: "你", text: "问题" })
const answer = (id: string): ChatMessage => ({ id, role: "assistant", label: "CodeM", text: id })
const tool = (id: string): ChatMessage => ({ id, role: "tool", label: "搜索", text: "结果", summary: "", status: "completed" })
const ids = (messages: readonly ChatMessage[]) => timelineGroups(messages).map(group => group.kind === "message" ? group.message.id : group.messages.map(message => message.id))

it("keeps one processing group across progress replies, with every reply outside in its own order", () => {
  const reasoning: ChatMessage = { id: "r", role: "reasoning", label: "思考过程", text: "分析", summary: "", status: "completed" }
  const messages = [user("u"), reasoning, tool("t1"), answer("progress1"), tool("t2"), answer("progress2"), tool("t3"), answer("overview"), answer("followup")]
  for (const identified of [messages, messages.map(message => ({ ...message, turnId: "turn" }))]) {
    assert.deepEqual(ids(identified), ["u", ["r", "t1", "t2", "t3"], "progress1", "progress2", "overview", "followup"])
    const groups = timelineGroups(identified)
    assert.equal(groups.filter(group => group.kind === "work").length, 1, "Progress text must not split processing")
    assert.equal(groups.flatMap(group => group.kind === "work" ? group.messages : []).some(message => String(message.role) === "assistant"), false)
    assert.deepEqual(groups.flatMap(group => group.kind === "message" ? [group.message.id] : group.messages.map(message => message.id)).sort(), identified.map(message => message.id).sort())
  }
})
it("appends streaming work to the existing group without moving replies inside or changing group identity", () => {
  const initial = [user("u"), tool("t1"), answer("streaming")]
  const after = timelineGroups([...initial, tool("t2"), answer("final")])
  assert.deepEqual(after.filter(group => group.kind === "message").slice(0, 2), timelineGroups(initial).filter(group => group.kind === "message"))
  assert.equal(after[1]?.kind === "work" && after[1].id, "t1")
  assert.deepEqual(ids([...initial, tool("t2"), answer("final")]), ["u", ["t1", "t2"], "streaming", "final"])
  assert.deepEqual(ids([user("u"), answer("plain")]), ["u", "plain"])
  assert.deepEqual(timelineGroups([]), [])
})
it("keeps user and Core turn boundaries, failures and trailing tools without inventing a final answer", () => {
  const messages: ChatMessage[] = [user("u1"), tool("t1"), answer("a1"), user("u2"), answer("progress"), { ...tool("t2"), turnId: "turn2" }, { ...tool("t3"), turnId: "backgroundTurn" }, { ...tool("t4"), turnId: "turn2" }]
  assert.deepEqual(ids(messages), ["u1", ["t1"], "a1", "u2", "progress", ["t2", "t4"], ["t3"]])
  assert.deepEqual(ids([user("u1"), tool("t1"), answer("a1"), user("u2"), tool("t2")]), ["u1", ["t1"], "a1", "u2", ["t2"]])
  const failed: ChatMessage = { id: "failed", role: "tool", label: "执行", text: "失败", summary: "", status: "failed" }
  assert.deepEqual(timelineGroups([failed, answer("explanation")]), [{ kind: "work", id: "failed", messages: [failed] }, { kind: "message", message: answer("explanation") }])
})
