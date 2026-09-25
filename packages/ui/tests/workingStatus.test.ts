import { it } from "node:test"
import assert from "node:assert/strict"
import { workingStatus } from "../src/chat/workingStatus.ts"
import type { ChatMessage, ChatSnapshot, PanelKind } from "../src/contract.ts"

const user: ChatMessage = { id: "u", role: "user", label: "你", text: "开始" }
const reasoning: ChatMessage = { id: "r", role: "reasoning", label: "思考过程", status: "running", text: "", summary: "" }
const pending = { label: "正在思考与处理…", animate: true }
const panel = (kind: PanelKind): ChatSnapshot["pendingPanel"] => ({ id: kind, kind, title: "", description: "", detail: null, choices: [], allowText: false, multiple: false, backChoiceId: null, initialText: "", confirmLabel: null })
const status = (phase: ChatSnapshot["phase"], messages: ChatMessage[], pendingPanel: ChatSnapshot["pendingPanel"] = null) => workingStatus({ phase, messages, pendingPanel })

it("shows the initial placeholder only until this turn has progress", () => {
  assert.deepEqual(status("running", [user, reasoning]), pending)
  for (const progress of [
    { ...reasoning, summary: "正在分析实现方案" },
    { ...reasoning, text: "分析内容" },
    { ...reasoning, role: "tool" as const },
    { id: "a", role: "assistant" as const, label: "CodeM", text: "开始处理" },
    { ...reasoning, artifacts: [{ id: "f", kind: "file" as const, title: "文件", detail: "", available: true }] },
    { ...reasoning, hasArtifacts: true },
  ]) assert.equal(status("running", [user, progress]), null)
  assert.deepEqual(status("running", [{ ...reasoning, text: "上一轮" }, user]), pending)
})

it("preserves actionable waiting and stop feedback regardless of existing progress", () => {
  const messages = [user, { ...reasoning, summary: "已开始" }]
  for (const [kind, label] of [["approval", "等待你的批准…"], ["question", "等待你的回复…"], ["plan", "等待你确认计划…"], ["rewind", "等待选择回退范围…"]] as const) {
    assert.deepEqual(status("running", messages, panel(kind)), { label, animate: false })
    assert.deepEqual(status("stopping", messages, panel(kind)), { label: "正在停止…", animate: true })
  }
  assert.deepEqual(status("sending", [user]), pending)
  for (const phase of ["ready", "disconnected", "configuring", "loadingHistory"] as const)
    assert.equal(status(phase, messages, panel("approval")), null)
})

it("keeps one processing indicator through connection and sending until response progress", () => {
  const messages = [user, { ...reasoning, summary: "Previous turn progress" }]
  for (const phase of ["connecting", "sending"] as const) assert.deepEqual(status(phase, messages), pending)
  assert.deepEqual(status("running", [user]), pending)
  assert.equal(status("running", messages), null)
  for (const phase of ["ready", "disconnected", "loadingHistory"] as const) assert.equal(status(phase, messages), null)
})
