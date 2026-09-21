import type { ConversationItem } from "@codem/history"
import { projectToolDetails } from "../src/chat/toolDetails.ts"

// Core 0.8.44 input shapes. Build projects these in Node; only display DTOs enter the preview bundle.
export const toolInputs: { label: string; input: Extract<ConversationItem, { kind: "tool-execution" }>["input"]["value"]; text: string }[] = [
  { label: "run_bash", input: { command: "pnpm check", timeout: 120, background: false }, text: "类型检查通过。" },
  { label: "read_files", input: { files: [{ path: "/workspace/src/auth.ts", offset: 12, limit: 37 }, { path: "/workspace/src/main.ts", offset: 1, limit: 20 }] }, text: "=== src/auth.ts ===\n12: export async function connectWorkspace() {}" },
  { label: "grep", input: { pattern: "connectWorkspace", path: "/workspace/src", glob: "*.ts", output_mode: "content", "-C": 2, head_limit: 20 }, text: "src/main.ts:28 — connectWorkspace()" },
  { label: "web_fetch", input: { url: "https://example.com/docs", max_chars: 8000 }, text: "接口说明（样例）" },
  { label: "mcp__design__inspect_component", input: { token: "private-preview-token" }, text: "组件：LoginPanel\n尺寸：640 × 480" },
  { label: "dispatch", input: { label: "检查键盘交互", mode: "supervised", execution_profile: "read_only", prompt: "private-agent-contract" }, text: "任务已派发：task-demo" },
  { label: "skill", input: { name: "codem-plugin:codem-wiki" }, text: "已加载技能说明。" },
  { label: "glob", input: { pattern: "**/*.test.ts", path: "/workspace/src" }, text: "src/auth.test.ts" },
  { label: "search_and_read", input: { pattern: "connectWorkspace", path: "/workspace/src", top_k: 3, context_lines: 5 }, text: "src/auth.ts — 匹配 2 处。" },
  { label: "write_file", input: { path: "/workspace/src/new.ts", content: "private-file-content" }, text: "文件已写入。" },
  { label: "edit_file", input: { path: "/workspace/src/auth.ts", old_string: "before", new_string: "after", replace_all: false }, text: "已替换 1 处。" },
  { label: "multi_edit", input: { path: "/workspace/src/auth.ts", edits: [{ old_string: "before", new_string: "after" }, { old_string: "old", new_string: "new" }] }, text: "已原子应用 2 处修改。" },
  { label: "patch_file", input: { path: "/workspace/src/auth.ts", start_line: 12, old_line_count: 3, expected_old: "private-old-content", new_content: "private-new-content" }, text: "已替换目标行段。" },
  { label: "verify", input: { command: "pnpm test" }, text: "exit code: 0\nTests passed" },
  { label: "shell_bg_list", input: {}, text: "pid | running? | started_at | command\n42 | true | 10:00 | pnpm dev" },
  { label: "shell_bg_read", input: { pid: 42, since_offset: 1024, filter: "ready|error" }, text: "Server ready" },
  { label: "shell_bg_kill", input: { pid: 42 }, text: "killed 42" },
  { label: "list_dir", input: { path: "/workspace/src", max_depth: 2, show_hidden: false }, text: "auth.ts\nmain.ts" },
  { label: "web_search", input: { query: "TypeScript documentation" }, text: "TypeScript 官方文档" },
  { label: "tool_search", input: { query: "select:web_search" }, text: "已启用 web_search" },
  { label: "bg_status", input: { task_id: "task-demo" }, text: "running" },
  { label: "bg_cancel", input: { task_id: "task-demo" }, text: "cancelled" },
  { label: "bg_reply", input: { task_id: "task-demo", question_id: "question-1", message: "继续检查键盘导航" }, text: "消息已发送。" },
  { label: "task_create", input: { summary: "修复登录", contents: ["读取配置", { content: "修复解析器", activeForm: "正在修复解析器" }] }, text: "已创建任务列表。" },
  { label: "task_update", input: { updates: [{ id: "t-1", status: "completed" }, { id: "t-2", status: "in_progress", content: "验证解析器" }] }, text: "任务状态已更新。" },
  { label: "ask_user", input: { questions: [{ header: "验证范围", question: "需要验证哪些部分？", multiSelect: true, options: [{ label: "单元测试" }, { label: "界面交互" }] }] }, text: "已收到用户选择。" },
  { label: "enter_plan_mode", input: { reason: "先确认模块边界和实施顺序" }, text: "已进入计划模式。" },
  { label: "exit_plan_mode", input: { plan: "1. 梳理边界\n2. 实施变更\n3. 验证" }, text: "计划已确认。" },
  { label: "install_skill", input: { source: "https://example.com/review.zip", scope: "project", force: false }, text: "Installed 1 skill. Restart codem to pick up newly installed skills." },
  { label: "install_mcp_server", input: { name: "docs", transport: "stdio", command: "npx", args: ["private-argument"] }, text: "配置已写入，尚未加载。" },
  { label: "enter_worktree", input: { name: "fix-login" }, text: "已进入工作树 fix-login。" },
  { label: "exit_worktree", input: { action: "keep", discard_changes: false }, text: "已返回原工作区。" },
  { label: "sleep", input: { seconds: 15 }, text: "等待结束。" },
  { label: "describe_image", input: { file_path: "/workspace/assets/login.png", question: "提取错误提示" }, text: "图片显示登录失败提示。" },
  { label: "compact", input: { replaced: 24, kept: 8 }, text: "上下文已整理。" },
]

export const previewTools = toolInputs.map(({ label, input, text }) => {
  const details = projectToolDetails(label, input, "/workspace")
  if (!details) throw new Error(`Missing preview projection for ${label}`)
  return { label, details, text }
})

export function previewToolsSource(): string {
  return '// Generated by build.ts from previewToolSamples.ts and the Host projector. Do not edit.\nimport type { ToolDetails } from "../../src/shared/messages.ts"\nexport const previewTools: { label: string; details: ToolDetails; text: string }[] = [\n' + previewTools.map(tool => `  ${JSON.stringify(tool)},`).join("\n") + '\n]\n'
}
