import { it } from "node:test"
import assert from "node:assert/strict"
import { workingStatus } from "../webview/workingStatus.ts"
import type { ChatMessage } from "../src/messages.ts"

const user: ChatMessage = { id: "u", role: "user", label: "你", text: "开始" }
const reasoning: ChatMessage = { id: "r", role: "reasoning", label: "思考过程", status: "running", text: "", summary: "" }
const pending = { label: "正在思考与处理…", animate: true }
it("shows the initial placeholder only until this turn has progress", () => {
  assert.deepEqual(workingStatus({ phase: "running", messages: [user, reasoning] }, null), pending)
  for (const progress of [
    { ...reasoning, summary: "正在分析实现方案" },
    { ...reasoning, text: "分析内容" },
    { ...reasoning, role: "tool" as const },
    { id: "a", role: "assistant" as const, label: "CodeM", text: "开始处理" },
    { ...reasoning, artifacts: [{ id: "f", kind: "file" as const, title: "文件", detail: "", available: true }] },
  ]) assert.equal(workingStatus({ phase: "running", messages: [user, progress] }, null), null)
  assert.deepEqual(workingStatus({ phase: "running", messages: [{ ...reasoning, text: "上一轮" }, user] }, null), pending)
})
it("preserves actionable waiting and stop feedback regardless of existing progress", () => {
  const messages = [user, { ...reasoning, summary: "已开始" }]
  for (const [panel, label] of [["approval", "等待你的批准…"], ["question", "等待你的回复…"], ["plan", "等待你确认计划…"]] as const) {
    assert.deepEqual(workingStatus({ phase: "running", messages }, panel), { label, animate: false })
    assert.deepEqual(workingStatus({ phase: "stopping", messages }, panel), { label: "正在停止…", animate: true })
  }
  assert.deepEqual(workingStatus({ phase: "sending", messages: [user] }, null), pending)
  for (const phase of ["ready", "disconnected", "configuring", "loadingHistory"] as const)
    assert.equal(workingStatus({ phase, messages }, "approval"), null)
})


it("keeps one processing indicator throughout first submission, connection and sending", () => {
  const messages = [user, { ...reasoning, summary: "Previous turn progress" }]
  for (const phase of ["disconnected", "connecting", "ready", "sending"] as const)
    assert.deepEqual(workingStatus({ phase, messages }, null, true), pending)
  assert.deepEqual(workingStatus({ phase: "running", messages: [user] }, null, true), pending)
  assert.equal(workingStatus({ phase: "running", messages }, null, true), null)
  for (const phase of ["ready", "disconnected"] as const)
    assert.equal(workingStatus({ phase, messages: [] }, null, false), null)
  assert.equal(workingStatus({ phase: "loadingHistory", messages }, null, true), null)
})
