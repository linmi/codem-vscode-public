import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { it } from "node:test"
import type { SessionHistoryPage } from "@codem/session-history"
import { parseAppServerItem } from "../../../packages/app-server/src/items.ts"
import { projectToolDetails } from "../src/chat/toolDetails.ts"
import { historyMessages } from "../src/sessionHistory/historyMessages.ts"
import type { ActivityMessage, ActivityStatus } from "../src/shared/messages.ts"
import { activityTitle, toolPresentation } from "../webview/transcript/toolPresentation.ts"
import { toolInputs, previewTools, previewToolsSource } from "./previewToolSamples.ts"
import { previewTools as browserTools } from "./fixtures/previewTools.ts"

const project = (name: string, input: unknown) => projectToolDetails(name, input, "/workspace")
const values = (name: string, input: unknown) => project(name, input)?.fields.map(field => field.value)
const message = (label: string, input: unknown, status: ActivityStatus = "completed"): ActivityMessage => ({ id: "call", role: "tool", label, status, text: "private-output", summary: "", details: project(label, input) ?? undefined })

it("covers all 31 discovered Core builtins plus conditional image, plan and compaction records", () => {
  const builtin = "ask_user write_file edit_file multi_edit patch_file run_bash verify shell_bg_list shell_bg_read shell_bg_kill list_dir grep glob read_files search_and_read install_skill install_mcp_server web_fetch web_search sleep bg_status bg_cancel bg_reply dispatch task_create task_update skill tool_search enter_worktree exit_worktree enter_plan_mode".split(" ")
  assert.equal(builtin.length, 31)
  for (const name of [...builtin, "describe_image", "exit_plan_mode", "compact"]) {
    const sample = toolInputs.find(tool => tool.label === name)!
    assert.ok(sample, name)
    assert.notEqual(toolPresentation(name).title, name)
    for (const status of ["running", "completed", "failed", "declined", "interrupted", "incomplete"] as const) {
      const title = activityTitle(message(name, sample.input, status))
      assert.match(title, /正在|已|失败|未完成/)
      assert.doesNotMatch(title, /private-output|undefined|\[object Object\]/)
      if (status !== "completed") assert.notEqual(title, activityTitle(message(name, sample.input, "completed")), `${name}: ${status}`)
    }
  }
})

it("associates each file with its actual read window, handles numeric strings and rejects old input shapes", () => {
  assert.deepEqual(values("read_files", { files: [{ path: "/workspace/a.ts", offset: "12", limit: "37" }, { path: "/private/b.ts", offset: 7, force: true }] }), ["a.ts（第 12–48 行）", "b.ts（从第 7 行起） · 强制重读"])
  assert.deepEqual(values("read_files", { path: "a.ts", limit: 5 }), ["a.ts（前 5 行）"])
  assert.equal(project("read_files", { paths: ["a.ts"] }), null)
  assert.equal(project("read_files", { path: "a.ts", files: [] }), null)
  assert.equal(project("read_files", { files: [null, "private", {}] }), null)
  assert.deepEqual(values("patch_file", { path: "a.ts", start_line: 3, old_line_count: 0 }), ["a.ts", "第 3 行前插入"])
  assert.deepEqual(values("patch_file", { path: "a.ts", start_line: 3, old_line_count: 2 }), ["a.ts", "第 3–4 行"])
  assert.deepEqual(values("multi_edit", { path: "a.ts", edits: [{}, {}] }), ["a.ts", "2 处"])
})

it("renders search limits, directory depth, command mode and background log cursor without losing zero", () => {
  assert.deepEqual(values("grep", { pattern: "foo", "-C": 2, offset: 0, head_limit: 20, output_mode: "content" }), ["foo", "匹配内容", "2 行", "0 条", "20 条"])
  assert.deepEqual(values("search_and_read", { pattern: "foo", top_k: 3, context_lines: 5 }), ["foo", "3 个文件", "5 行"])
  assert.deepEqual(values("list_dir", { path: "src", max_depth: 2, show_hidden: false }), ["src", "2 层", "否"])
  assert.deepEqual(values("run_bash", { command: "pnpm check", timeout: 120, background: true }), ["120 秒", "是"])
  assert.deepEqual(values("shell_bg_read", { pid: 42, since_offset: 0, filter: "error" }), ["42", "0 字节", "error"])
  assert.deepEqual(values("sleep", { seconds: 15 }), ["15 秒"])
  assert.deepEqual(values("sleep", { seconds: -1 }), [])
  assert.deepEqual(values("compact", { replaced: 0, kept: 8 }), ["0 条记录", "8 条记录"])
})

it("uses actual dispatch mode / agent and preserves distinct subagent protocol metadata", () => {
  assert.deepEqual(values("dispatch", { label: "审阅", mode: "oneshot", execution_profile: "read_only", prompt: "private-contract" }), ["审阅", "单次任务", "read_only"])
  assert.deepEqual(values("dispatch", { label: "审阅", mode: "oneshot", agent: "reviewer" }), ["审阅", "reviewer", "持续协作"])
  const item = parseAppServerItem({ id: "s", type: "subagent", status: "inProgress", label: "审阅", subagentKind: "reviewer" }, "fixture")
  assert.deepEqual(values(item.toolName!, item.input), ["审阅", "reviewer"])
  assert.deepEqual(values("bg_status", {}), ["本会话的全部子任务"])
  assert.deepEqual(values("bg_reply", { task_id: "t-1", question_id: "q-1", message: "继续" }), ["t-1", "q-1", "继续"])
  assert.equal(activityTitle(message("dispatch", { label: "审阅" })), "已派发子任务 审阅")
})

it("shows task operations, questions, install activation conditions and worktree intent", () => {
  assert.deepEqual(values("ask_user", { questions: [{ header: "范围", question: "验证什么？", options: [{ label: "类型" }, { label: "交互" }], multiSelect: true }] }), ["范围 · 验证什么？", "类型、交互"])
  assert.deepEqual(values("exit_worktree", { action: "remove", discard_changes: false }), ["删除工作树和分支", "否"])
  assert.ok(values("install_skill", { source: "/private/my-skill", scope: "project" })?.includes("my-skill"))
  assert.ok(values("install_mcp_server", { name: "docs", transport: "stdio" })?.includes("安装成功后需重新加载 MCP 或开启新会话"))
  assert.deepEqual(values("describe_image", { image_ref: "#1", question: "OCR" }), ["#1", "OCR"])
  assert.equal(project("describe_image", { image_ref: "#1", file_path: "/private/img.png" }), null)
})

it("never duplicates MCP identity or publishes arbitrary args, source text and URL credentials", () => {
  for (const label of ["mcp__docs__search", "MCP · mcp__docs__search", "MCP · docs.search"]) {
    const tool = message(label, { query: "private-query", token: "private-token", env: { key: "private-key" } })
    assert.equal(activityTitle(tool), `已调用工具 ${label.replace(/^MCP · /, "")}`)
    assert.doesNotMatch(JSON.stringify(tool.details), /private-/)
  }
  assert.deepEqual(values("mcp__docs__search", {}), ["docs", "search"])
  assert.match(project("web_fetch", { url: "https://user:private-password@example.com/?token=private-token&q=docs#private-fragment" })!.fields[0]!.value, /q=docs/)
  assert.doesNotMatch(JSON.stringify(project("web_fetch", { url: "https://user:private-password@example.com/?api_key=private-key#private-fragment" })), /private-/)
  for (const input of [null, [], 1, "private"]) assert.equal(project("glob", input), null)
  assert.equal(project("unknown", { token: "private" }), null)
  assert.deepEqual(values("verify", { command: "pnpm test", timeout: 1, background: true }), [])
  assert.deepEqual(values("grep", { output_mode: "constructor" }), [])
  assert.equal(activityTitle(message("toString", {})), "已调用工具 toString")
  assert.doesNotMatch(JSON.stringify(previewTools), /private-/)
  assert.doesNotMatch(activityTitle(message("exit_plan_mode", { plan: "long private-plan" })), /private-plan/)
})

it("restores every tool with the same details as live item projection, without reviving unfinished calls", () => {
  const at = "2026-09-21T00:00:00Z"
  for (const sample of toolInputs) {
    const page: SessionHistoryPage = { todoSnapshot: null, nextCursor: null, turns: [{ submissionId: "s", turn: {
      id: "turn", index: 0, engineTurnIndexes: [0], model: "fixture", provider: "fixture", startedAt: at, completedAt: at, state: "completed", usage: null,
      items: [{ id: "call", at, kind: "tool-execution", toolCallId: "call", toolName: sample.label, input: { value: sample.input, preview: "private", previewTruncated: false }, result: null, status: "running" }],
    } }] }
    const [restored] = historyMessages("thread", page, undefined, undefined, "/workspace")
    assert.ok(restored?.role === "tool")
    assert.equal(restored.status, "incomplete")
    const live = parseAppServerItem({ id: "call", type: "toolCall", status: "inProgress", tool: sample.label, arguments: sample.input }, "fixture")
    assert.deepEqual(restored.details, project(live.toolName!, live.input), sample.label)
  }
})

it("browser fixtures are generated from production projection and cannot silently acquire richer fake fields", async () => {
  assert.deepEqual(browserTools, previewTools)
  assert.equal(await readFile(new URL("./fixtures/previewTools.ts", import.meta.url), "utf8"), previewToolsSource(), "Run pnpm build:vscode to refresh projected fixtures")
  assert.ok(!browserTools[0]!.details.fields.some(field => field.label === "退出码"))
})
