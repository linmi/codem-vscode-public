import assert from "node:assert/strict"
import { it } from "node:test"
import { projectToolDetails } from "../src/chat/toolDetails.ts"
import { activityTitle } from "../../../packages/ui/src/chat/toolPresentation.ts"
import type { ActivityMessage } from "../src/shared/messages.ts"
const tool: ActivityMessage = { id: "t", role: "tool", label: "run_bash", status: "completed", summary: "", text: "private output", details: { kind: "command", code: "pnpm\ncheck", fields: [] } }
it("summarizes safe input with the real activity status, never tool output", () => {
  assert.equal(activityTitle(tool), "已运行 pnpm check")
  assert.equal(activityTitle({ ...tool, status: "running" }), "正在运行 pnpm check")
  assert.equal(activityTitle({ ...tool, status: "failed" }), "执行命令失败 pnpm check")
  assert.equal(activityTitle({ ...tool, details: undefined }), "已运行")
  assert.equal(activityTitle({ ...tool, label: "read_files", details: { kind: "file", code: null, fields: [{ label: "文件", value: "src/main.ts" }] } }), "已读取 src/main.ts")
})
it("uses supplied reasoning summaries and preserves unknown tool names", () => {
  assert.equal(activityTitle({ ...tool, role: "reasoning", summary: "检查连接生命周期" }), "检查连接生命周期")
  assert.equal(activityTitle({ ...tool, label: "custom", details: undefined }), "已调用工具 custom")
})

it("shows actual Core search terms and batched file names using the safe input projection", () => {
  const details = projectToolDetails("grep", { pattern: "requestId", path: "/workspace/src", glob: "*.ts", env: { SECRET: "hidden" }, unknown: "private output" }, "/workspace")!
  assert.equal(activityTitle({ ...tool, label: "grep", details }), "已搜索内容 requestId、src、*.ts")
  assert.doesNotMatch(JSON.stringify(details), /workspace|SECRET|hidden|private output/)
  const files = projectToolDetails("read_files", { files: [{ path: "/workspace/src/main.ts", offset: 10 }, { path: "/workspace/src/types.ts" }] }, "/workspace")!
  assert.equal(activityTitle({ ...tool, label: "read_files", details: files }), "已读取 src/main.ts（从第 10 行起）、src/types.ts")
  assert.equal(projectToolDetails("read_files", { path: "/workspace/src/main.ts" }, "/workspace")!.fields[0]!.value, "src/main.ts")
  assert.equal(projectToolDetails("read_files", { paths: ["/workspace/obsolete"] }, "/workspace"), null)
  assert.equal(projectToolDetails("read_files", { files: [{ path: "a" }], path: "b" }, "/workspace"), null)
  assert.equal(activityTitle({ ...tool, label: "read_files", details: undefined }), "已读取文件")
})

it("shows the actual skill name, plugin and every loading outcome without guessing from output", () => {
  const details = projectToolDetails("skill", { name: "codem-plugin:codem-wiki", path: "/private/skill.md", token: "secret", description: "unverified" }, "/workspace")!
  assert.deepEqual(details, { kind: "skill", fields: [{ label: "技能", value: "codem-plugin:codem-wiki" }, { label: "插件", value: "codem-plugin" }], code: null })
  const titles = { running: "正在加载技能", completed: "已加载技能", failed: "加载技能失败", declined: "已拒绝加载技能", interrupted: "已停止加载技能", incomplete: "技能加载未完成" } as const
  for (const status of Object.keys(titles) as (keyof typeof titles)[]) {
    assert.equal(activityTitle({ ...tool, label: "skill", status, details }), `${titles[status]} codem-plugin:codem-wiki`)
    assert.equal(activityTitle({ ...tool, label: "skill", status, details: undefined }), titles[status])
  }
  assert.deepEqual(projectToolDetails("skill", { name: "review" }, "/workspace")?.fields, [{ label: "技能", value: "review" }])
  for (const input of [null, {}, { skill: "guessed alias" }, { name: 2 }, { name: "" }, { name: " skill " }, { name: "/private/SKILL.md" }, { name: "C:\\private\\SKILL.md" }, { name: "name\nsecret" }, { name: "x".repeat(257) }]) assert.equal(projectToolDetails("skill", input, "/workspace"), null)
})
