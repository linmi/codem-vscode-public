import assert from "node:assert/strict"
import { it } from "node:test"
import { timelineGroups } from "../src/chat/timelineGroups.ts"
import type { ChatMessage } from "../src/contract.ts"
const user = (id: string): ChatMessage => ({ id, role: "user", label: "你", text: "问题" })
const answer = (id: string): ChatMessage => ({ id, role: "assistant", label: "CodeM", text: id })
const tool = (id: string): ChatMessage => ({ id, role: "tool", label: "搜索", text: "结果", summary: "", status: "completed" })
const ids = (messages: readonly ChatMessage[]) => timelineGroups(messages).map(group => group.kind === "message" ? group.message.id : group.messages.map(message => message.id))

it("folds intermediate progress with its work while preserving all trailing answer content", () => {
  const reasoning: ChatMessage = { id: "r", role: "reasoning", label: "思考过程", text: "分析", summary: "", status: "completed" }
  const messages = [user("u"), reasoning, tool("t1"), answer("progress1"), tool("t2"), answer("progress2"), tool("t3"), answer("overview"), answer("followup")]
  for (const identified of [messages, messages.map(message => ({ ...message, turnId: "turn" }))]) {
    assert.deepEqual(ids(identified), ["u", ["r", "t1", "progress1", "t2", "progress2", "t3"], "overview", "followup"])
    const groups = timelineGroups(identified)
    assert.equal(groups.filter(group => group.kind === "work").length, 1, "Progress text must not split processing")
    assert.deepEqual(groups.flatMap(group => group.kind === "work" ? group.messages.filter(message => message.role === "assistant").map(message => message.id) : []), ["progress1", "progress2"])
    assert.deepEqual(groups.flatMap(group => group.kind === "message" ? [group.message.id] : group.messages.map(message => message.id)).sort(), identified.map(message => message.id).sort())
  }
})
it("moves confirmed progress into the existing group when later work arrives, without changing its identity", () => {
  const initial = [user("u"), tool("t1"), answer("streaming")]
  const after = timelineGroups([...initial, tool("t2"), answer("final")])
  assert.deepEqual(ids(initial), ["u", ["t1"], "streaming"], "An unconfirmed streaming answer remains visible")
  assert.equal(after[1]?.kind === "work" && after[1].id, "t1")
  assert.deepEqual(ids([...initial, tool("t2"), answer("final")]), ["u", ["t1", "streaming", "t2"], "final"])
  assert.deepEqual(ids([user("u"), answer("plain")]), ["u", "plain"])
  assert.deepEqual(timelineGroups([]), [])
})
it("keeps user and Core turn boundaries, failures and trailing tools without inventing a final answer", () => {
  const messages: ChatMessage[] = [user("u1"), tool("t1"), answer("a1"), user("u2"), answer("progress"), { ...tool("t2"), turnId: "turn2" }, { ...tool("t3"), turnId: "backgroundTurn" }, { ...tool("t4"), turnId: "turn2" }]
  assert.deepEqual(ids(messages), ["u1", ["t1"], "a1", "u2", "progress", ["t2", "t4"], ["t3"]])
  assert.deepEqual(ids([user("u1"), tool("t1"), answer("a1"), user("u2"), tool("t2")]), ["u1", ["t1"], "a1", "u2", ["t2"]])
  const failed: ChatMessage = { id: "failed", role: "tool", label: "执行", text: "失败", summary: "", status: "failed" }
  assert.deepEqual(timelineGroups([failed, answer("explanation")]), [{ kind: "work", id: "failed", messages: [failed], hasResult: true }, { kind: "message", message: answer("explanation") }])
})

it("folds pre-tool progress and cancelled work without hiding answers from another turn or artifact deliveries", () => {
  assert.deepEqual(ids([user("u"), answer("start"), tool("t"), answer("final")]), ["u", ["start", "t"], "final"])
  assert.deepEqual(ids([user("u"), answer("start"), { ...tool("t"), status: "interrupted" }]), ["u", ["start", "t"]])
  assert.deepEqual(ids([{ ...answer("final1"), turnId: "one" }, { ...tool("t2"), turnId: "two" }]), ["final1", ["t2"]])
  assert.deepEqual(ids([answer("previous"), user("new"), tool("next")]), ["previous", "new", ["next"]])
  const delivered = { ...answer("artifact"), hasArtifacts: true }
  assert.deepEqual(ids([delivered, tool("late")]), ["artifact", ["late"]])
})

it("associates usable final results with only their own work and user submission", () => {
  const hasResult = (messages: ChatMessage[]) => timelineGroups(messages).flatMap(group => group.kind === "work" ? [group.hasResult] : [])
  const failed: ChatMessage = { ...tool("failed"), status: "failed" }
  assert.deepEqual(hasResult([failed, answer("result")]), [true])
  assert.deepEqual(hasResult([answer("progress"), failed]), [false], "Intermediate progress is not a final result")
  assert.deepEqual(hasResult([failed, { ...answer("blank"), text: " \n" }]), [false])
  assert.deepEqual(hasResult([failed, { ...answer("artifact"), text: "", hasArtifacts: true }]), [true])
  assert.deepEqual(hasResult([{ ...answer("artifact"), hasArtifacts: true }, failed]), [true], "Delivered artifacts remain results when later work follows")
  assert.deepEqual(hasResult([{ ...failed, turnId: "one" }, { ...answer("other"), turnId: "two" }]), [false])
  assert.deepEqual(hasResult([failed, user("next"), answer("next-result")]), [false])
  assert.deepEqual(hasResult([tool("first"), answer("first-result"), user("next"), failed]), [true, false])
})
