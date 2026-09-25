import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ActivityStatus, ChatMessage } from "../src/contract.ts"
import { activityBadge, activityPlaceholder } from "../src/chat/toolPresentation.ts"

const statuses: readonly ActivityStatus[] = ["running", "completed", "failed", "declined", "interrupted", "incomplete"]

const tool = (status?: ActivityStatus, label = "grep"): ChatMessage => ({ id: "tool", role: "tool", text: "", label, ...(status ? { status } : {}) })
const reasoning = (status?: ActivityStatus): ChatMessage => ({ id: "think", role: "reasoning", text: "", ...(status ? { status } : {}) })

describe("activity row badge and placeholder", () => {
  it("labels every status separately for tools and thinking", () => {
    assert.deepEqual(
      statuses.map((status) => activityBadge(tool(status))),
      ["进行中", "已完成", "失败", "已拒绝", "已停止", "未完成"],
    )
    assert.deepEqual(
      statuses.map((status) => activityBadge(reasoning(status))),
      ["思考中", "思考完成", "思考失败", "已拒绝", "思考已停止", "思考未完成"],
    )
  })

  it("treats a missing status as completed", () => {
    assert.equal(activityBadge(tool()), "已完成")
    assert.equal(activityBadge(reasoning()), "思考完成")
    assert.equal(activityPlaceholder(tool()), "无文本输出。")
    assert.equal(activityPlaceholder(reasoning()), "Core 未提供可显示的思考内容。")
  })

  it("explains an empty body while running, after an incomplete turn and after completion", () => {
    assert.equal(activityPlaceholder(reasoning("running")), "正在思考…")
    assert.equal(activityPlaceholder(tool("running", "skill")), "正在加载技能说明…")
    assert.equal(activityPlaceholder(tool("running")), "等待工具输出…")
    assert.equal(activityPlaceholder(tool("incomplete")), "未收到完成结果。")
    assert.equal(activityPlaceholder(reasoning("incomplete")), "未收到完成结果。")
    for (const status of ["completed", "failed", "declined", "interrupted"] as const) {
      assert.equal(activityPlaceholder(tool(status)), "无文本输出。", status)
      assert.equal(activityPlaceholder(reasoning(status)), "Core 未提供可显示的思考内容。", status)
    }
  })
})
