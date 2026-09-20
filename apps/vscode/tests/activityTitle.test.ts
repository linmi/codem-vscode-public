import assert from "node:assert/strict"
import { it } from "node:test"
import { activityTitle } from "../webview/transcript/toolPresentation.ts"
import type { ActivityMessage } from "../src/shared/messages.ts"
const tool: ActivityMessage = { id: "t", role: "tool", label: "run_bash", status: "completed", summary: "", text: "private output", details: { kind: "command", code: "pnpm\ncheck", fields: [] } }
it("summarizes safe input with the real activity status, never tool output", () => {
  assert.equal(activityTitle(tool), "已运行 pnpm check")
  assert.equal(activityTitle({ ...tool, status: "running" }), "正在运行 pnpm check")
  assert.equal(activityTitle({ ...tool, status: "failed" }), "执行命令 pnpm check")
  assert.equal(activityTitle({ ...tool, details: undefined }), "已运行")
  assert.equal(activityTitle({ ...tool, label: "read_files", details: { kind: "file", code: null, fields: [{ label: "文件", value: "src/main.ts" }] } }), "已读取 src/main.ts")
})
it("uses supplied reasoning summaries and preserves unknown tool names", () => {
  assert.equal(activityTitle({ ...tool, role: "reasoning", summary: "检查连接生命周期" }), "检查连接生命周期")
  assert.equal(activityTitle({ ...tool, label: "custom", details: undefined }), "custom")
})
