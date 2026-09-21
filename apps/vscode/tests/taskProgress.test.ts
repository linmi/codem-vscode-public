import assert from "node:assert/strict"
import { it } from "node:test"
import { projectTaskDetails } from "../src/chat/taskDetails.ts"

it("projects both Core task content forms and preserves execution order without raw fields", () => {
  const details = projectTaskDetails("task_create", { summary: "完成登录", contents: ["检查接口", { content: "编写界面", activeForm: "正在编写界面", secret: "hidden" }], replace: ["t-old"], token: "secret" })!
  assert.equal(details.fields.find(field => field.label === "目标")?.value, "完成登录")
  assert.deepEqual(details.fields.filter(field => field.label === "任务").map(field => field.value), ["检查接口", "编写界面"])
  assert.equal(details.fields.find(field => field.label === "进行时文案")?.value, "正在编写界面")
  assert.ok(details.fields.some(field => field.label === "替换任务" && field.value === "t-old"))
  assert.doesNotMatch(JSON.stringify(details), /secret|hidden/)
})
it("projects batch and single updates, dependencies, clear active form and deletion", () => {
  const batch = projectTaskDetails("task_update", { updates: [{ id: "t-a", status: "completed", content: "检查接口" }, { id: "t-b", status: "in_progress", activeForm: "正在编写界面", addBlockedBy: ["t-a"], removeBlockedBy: ["t-c"] }, { id: "t-c", activeForm: "" }, { id: "t-d", delete: true, status: "ignored" }] })!
  assert.equal(batch.fields.filter(field => field.label === "任务").length, 4)
  assert.ok(batch.fields.some(field => field.value === "等待：t-a"))
  assert.ok(batch.fields.some(field => field.value === "清除进行时文案"))
  assert.ok(batch.fields.some(field => field.value === "移除任务"))
  assert.deepEqual(projectTaskDetails("task_update", { id: "t-a", status: "completed", content: "检查接口" })!.fields.slice(1), batch.fields.slice(1, 3))
})
it("rejects unknown statuses, invalid entries and guessed legacy input shapes", () => {
  for (const value of [{}, { summary: "x", contents: [] }, { summary: "x", contents: ["ok", 2] }, { summary: "x", contents: ["ok"], replace: ["/private/path"] }, { summary: "x", tasks: ["old"] }]) assert.equal(projectTaskDetails("task_create", value), null)
  for (const value of [{}, { updates: [] }, { id: "t-a" }, { id: "t-a", status: "done" }, { id: "/private/path", status: "completed" }, { id: "t-a", content: " " }, { id: "t-a", addBlockedBy: [2] }, { id: "t-a", activeForm: null }, { id: "t-a", delete: "true" }]) assert.equal(projectTaskDetails("task_update", value), null)
})
it("restores the same task DTO from durable history without promoting unfinished calls", async () => {
  const { historyMessages } = await import("../src/sessionHistory/historyMessages.ts")
  const input = { updates: [{ id: "t-check", status: "completed", content: "验证交互" }] }
  const at = "2026-09-21T00:00:00Z"
  const messages = historyMessages("thread", { todoSnapshot: null, nextCursor: null, turns: [{ submissionId: "submission", turn: {
    id: "turn", index: 0, engineTurnIndexes: [0], model: "fixture", provider: "fixture", startedAt: at, completedAt: at, state: "stopped", usage: null,
    items: (["succeeded", "running", "failed"] as const).map(status => ({ id: status, at, kind: "tool-execution" as const, toolCallId: status, toolName: "task_update", input: { value: input, preview: JSON.stringify(input), previewTruncated: false }, result: null, status })),
  } }] })
  assert.deepEqual(messages.flatMap(message => "status" in message ? [message.status] : []), ["completed", "incomplete", "failed"])
  for (const message of messages.filter(message => message.role === "tool")) {
    assert.ok("status" in message)
    assert.deepEqual(message.details, projectTaskDetails("task_update", input))
  }
})
