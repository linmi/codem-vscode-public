import type { ActivityStatus, ChatSnapshot, ToolDetails } from "../src/shared/messages.ts"
import type { CatalogKind } from "../src/shared/capabilityTypes.ts"
import type { PanelView } from "../src/shared/panelTypes.ts"

export type PreviewSurface = "files" | "background" | "tools" | "sessionTools" | "capabilities" | "activities"
interface ContentScenario {
  id: string
  group: string
  label: string
  apply: (state: ChatSnapshot) => void
  surface?: PreviewSurface
  panel?: PanelView
}
export const previewImage = "/previewDashboard.png"
const note = "以下为本地界面样例，不代表真实执行结果。"
function answer(state: ChatSnapshot, text: string) {
  state.messages = [state.messages[0]!, { id: "richAnswer", role: "assistant", label: "CodeM", text: `${text}\n\n${note}` }]
}
const tools: { label: string; details: ToolDetails; text: string }[] = [
  { label: "run_bash", details: { kind: "command", code: "pnpm --filter codem typecheck", fields: [{ label: "工作目录", value: "workspace" }, { label: "退出码", value: "0" }] }, text: "检查 Host、Webview 与共享协议…\n类型检查通过，未产生构建文件。" },
  { label: "read_files", details: { kind: "file", code: null, fields: [{ label: "文件", value: "src/auth.ts" }, { label: "范围", value: "12–48 行" }] }, text: "export async function connectWorkspace() {\n  const account = await readAccount()\n  return connect(account.workspace)\n}" },
  { label: "grep", details: { kind: "search", code: null, fields: [{ label: "查询", value: "connectWorkspace" }, { label: "目录", value: "apps/vscode/src" }] }, text: "src/extension.ts:28 — connectWorkspace()\nsrc/chat/chatController.ts:114 — connectWorkspace(options)\n共找到 2 处调用。" },
  { label: "web_fetch", details: { kind: "web", code: null, fields: [{ label: "来源", value: "https://example.com/docs" }, { label: "标题", value: "接口说明（样例）" }] }, text: "已读取公开接口说明。\n## 状态\n请求可以完成、失败或被取消。" },
  { label: "MCP · design.inspect", details: { kind: "mcp", code: null, fields: [{ label: "服务器", value: "design-preview" }, { label: "工具", value: "inspect_component" }] }, text: "组件：LoginPanel\n尺寸：640 × 480\n状态：default / loading / error\n这里只展示允许公开的摘要。" },
  { label: "子代理 · 检查交互", details: { kind: "subagent", code: null, fields: [{ label: "任务", value: "检查键盘导航与焦点恢复" }, { label: "结果", value: "完成" }] }, text: "已检查菜单、审批与历史面板。\n发现 1 项待改进：窄窗口长内容的滚动边界。" },
]
function toolMessages(state: ChatSnapshot, statuses: ActivityStatus[]) {
  state.messages = [state.messages[0]!, ...tools.map((tool, i) => ({ id: `richTool${i}`, role: "tool" as const, label: tool.label, details: tool.details, text: tool.text, status: statuses[i % statuses.length]!, summary: `${tool.details.kind} · ${statuses[i % statuses.length]}` })), { id: "toolSummary", role: "assistant", label: "CodeM", text: `六类工具详情已列出，可逐项展开查看参数与输出。\n\n${note}` }]
}
function historyRows() {
  return Array.from({ length: 14 }, (_, i) => ({ id: `history${i}`, title: ["整理登录页面", "检查依赖与构建", "修复长内容滚动", "审阅接口变更"][i % 4]! + ` · 第 ${i + 1} 次`, startedAt: new Date(Date.UTC(2026, 8, 20 - Math.floor(i / 3), 10, i)).toISOString(), turnCount: i + 1, archived: i === 4 }))
}
const longPanel: PanelView = { id: "longQuestion", kind: "question", title: "验证范围 · 1/2", description: "选择需要覆盖的展示能力，可多选并补充说明。", detail: null, backChoiceId: null, initialText: "保留键盘操作和错误恢复。", multiple: true, allowText: true, confirmLabel: "下一题", choices: Array.from({ length: 12 }, (_, i) => ({ id: `scope${i}`, label: ["工具详情", "附件与图片", "产物卡片", "历史与恢复"][i % 4]! + ` ${i + 1}`, description: "分别检查加载、成功、失败、取消以及切换上下文后的状态。", selected: i === 0 })) }
const rewindPanel: PanelView = { ...longPanel, id: "rewindPreview", kind: "rewind", title: "选择回退检查点", description: "仅演示检查点选择，不执行真实回退。", initialText: "", multiple: false, allowText: false, confirmLabel: "继续", choices: [{ id: "checkpoint1", label: "添加表单校验之前", description: "2 个文件 · 首次实现", selected: true }, { id: "checkpoint2", label: "补充错误提示之前", description: "1 个文件 · 最近一次修改", selected: false }] }

const catalogSamples: Record<CatalogKind, { label: string; detail: string }[]> = {
  skills: [{ label: "review-ui", detail: "检查布局、键盘操作与状态反馈" }, { label: "inspect-tests", detail: "整理测试覆盖与未验证项" }],
  environment: [{ label: "Node.js", detail: "22.23.2 · 本地运行环境样例" }, { label: "包管理器", detail: "pnpm 12.4.1" }, { label: "工作区", detail: "codem-plugin · 已信任（模拟）" }],
  config: [{ label: "工作模式", detail: "Agent" }, { label: "权限", detail: "默认审批" }, { label: "思考强度", detail: "medium" }],
  hooks: [{ label: "before_tool", detail: "检查工具执行条件 · 启用" }, { label: "after_tool", detail: "记录执行摘要 · 启用" }],
  plugins: [{ label: "design-preview", detail: "界面检查工具 · 已配置（样例）" }, { label: "docs-preview", detail: "文档索引 · 未加载（样例）" }],
  permissions: [{ label: "默认权限", detail: "由 Core 请求必要批准" }, { label: "完全访问", detail: "跳过工具权限审批；当前未选择" }],
  spaces: [{ label: "研发团队", detail: "当前空间（样例）" }, { label: "个人空间", detail: "可切换；开始新会话" }],
  provider: [{ label: "Auto", detail: "由路由器选择模型（样例）" }, { label: "CodeM Reasoning", detail: "文本与图片 · 200,000 tokens（样例）" }],
  live: [{ label: "当前会话", detail: "空闲 · 可以继续发送" }, { label: "订阅", detail: "已连接（模拟）" }, { label: "后台资源", detail: "1 个终端 / 2 个唤醒任务（样例）" }],
}
export function applyPreviewCatalog(state: ChatSnapshot, kind: CatalogKind) {
  state.sessionTools.catalog = { kind, loaded: true, stale: false, rows: structuredClone(catalogSamples[kind]) }
  state.sessionTools.skills = [{ id: "reviewUi", name: "review-ui", description: "检查布局与交互" }, { id: "inspectTests", name: "inspect-tests", description: "检查测试覆盖" }]
}
const catalogDefinitions = [
  ["catalogSkills", "技能目录", "skills"], ["catalogEnvironment", "运行环境与依赖", "environment"],
  ["catalogConfig", "配置概览", "config"], ["catalogHooks", "Hooks 目录", "hooks"],
  ["catalogPlugins", "插件目录", "plugins"], ["catalogPermissions", "权限档案", "permissions"],
  ["catalogSpaces", "Core 空间快照", "spaces"], ["catalogProvider", "模型能力目录", "provider"], ["catalogLive", "实时会话快照", "live"],
] as const

export const contentScenarios = [
  { id: "richMarkdown", group: "内容", label: "Markdown · 表格与代码", apply: (s: ChatSnapshot) => answer(s, "# 工作区检查报告\n\n## 变更概览\n\n正文包含 **重点**、*说明*、~~已废弃方案~~、`inlineCode` 与 [公开链接](https://example.com)。\n\n> 提示：此处展示引用、列表和代码之间的间距。\n\n| 模块 | 状态 | 说明 |\n| --- | --- | --- |\n| 登录 | 完成 | 保留取消后的输入 |\n| 历史 | 待验证 | 增量加载与恢复 |\n| 工具 | 完成 | 参数与输出分开展示 |\n\n- [x] 普通列表和任务列表\n- [ ] 深浅主题与窄栏验证\n\n1. 连接工作区\n2. 执行检查\n   - 展开工具记录\n   - 查看失败输出\n\n```ts\ninterface Result { status: 'ready' | 'failed'; message: string }\nconst result: Result = { status: 'ready', message: '检查完成' }\n```\n\n```diff\n- const label = '等待'\n+ const label = '正在连接工作区…'\n```\n\n---\n\n### 后续验证\n保留失败原因和可执行的重试入口。") },
  { id: "longConversation", group: "对话", label: "多轮长对话与滚动", apply: (s: ChatSnapshot) => { s.messages = Array.from({ length: 12 }, (_, i) => [{ id: `longUser${i}`, role: "user" as const, label: "你", text: `第 ${i + 1} 轮：检查模块 ${i + 1} 的加载、失败与恢复状态。` }, { id: `longAssistant${i}`, role: "assistant" as const, label: "CodeM", text: `### 模块 ${i + 1}\n\n已梳理首次操作、重复操作及取消路径。\n\n- 加载时显示当前步骤。\n- 失败后保留输入。\n- 重试后清除旧提示。\n\n${note}` }]).flat() } },
  { id: "toolDetails", group: "工具", label: "六类工具 · 参数与输出", surface: "activities", apply: (s: ChatSnapshot) => toolMessages(s, ["completed"]) },
  { id: "toolStates", group: "工具", label: "工具 · 失败拒绝与中断", surface: "activities", apply: (s: ChatSnapshot) => toolMessages(s, ["completed", "failed", "declined", "interrupted", "incomplete"]) },
  { id: "toolLongOutput", group: "工具", label: "工具 · 长命令与日志", surface: "activities", apply: (s: ChatSnapshot) => { toolMessages(s, ["completed"]); s.messages = [s.messages[0]!, { ...s.messages[1]!, text: Array.from({ length: 80 }, (_, i) => `[${String(i).padStart(3, "0")}] 检查 src/components/WorkspacePanel.tsx · ${i % 9 ? "通过" : "跳过可选项"}`).join("\n") }] } },
  { id: "artifactGallery", group: "产物", label: "五类产物与长标题", apply: (s: ChatSnapshot) => { answer(s, "已整理文件、截图、图表、外部链接和代码差异。卡片只发送模拟句柄，不打开真实文件。"); s.messages = s.messages.map(m => m.role === "assistant" ? { ...m, artifacts: [
    { id: "report", kind: "file", title: "工作区展示能力与交互验收报告.md", detail: "docs/工作区展示能力与交互验收报告.md", available: true },
    { id: "image", kind: "image", title: "布局检查截图.png", detail: "960 × 540 · PNG", available: true },
    { id: "chart", kind: "chart", title: "各模块检查耗时", detail: "结构化图表数据 · 只读预览", available: true },
    { id: "url", kind: "url", title: "预览页面", detail: "example.com · 示例链接", available: true },
    { id: "diff", kind: "diff", title: "登录与错误提示修改", detail: "3 个文件 · +42 −17", available: true },
  ] } : m) } },
  { id: "artifactUnavailable", group: "产物", label: "历史产物 · 不可用", apply: (s: ChatSnapshot) => { answer(s, "历史产物句柄已失效，原回复仍可阅读。"); s.messages = s.messages.map(m => m.role === "assistant" ? { ...m, artifacts: ["file", "image", "chart", "url", "diff"].map(kind => ({ id: kind, kind: kind as "file" | "image" | "chart" | "url" | "diff", title: `历史 ${kind} 产物`, detail: "不可用 · 当前会话无法打开", available: false })) } : m) } },
  { id: "imageGallery", group: "附件", label: "图片预览与历史附件", apply: (s: ChatSnapshot) => { s.messages = [{ id: "imageUser", role: "user", label: "你", text: "参考这张界面截图检查布局。", attachments: [{ id: "screenshot", kind: "image", label: "工作区概览.png", preview: { kind: "image", dataUrl: previewImage } }, { id: "source", kind: "file", label: "src/components/Workspace.tsx", preview: { kind: "none" } }] }, { id: "imageAnswer", role: "assistant", label: "CodeM", text: `图片可打开查看原始尺寸，并通过 Escape 返回。\n\n${note}` }]; s.attachments = [{ id: "folder", label: "src/components", kind: "directory", preview: { kind: "none" } }] } },
  { id: "imageUnavailable", group: "附件", label: "图片加载失败与重试", apply: (s: ChatSnapshot) => { s.attachments = [{ id: "deferred", kind: "image", label: "稍后重试.png", preview: { kind: "deferred" } }, { id: "missing", kind: "image", label: "已删除的图片.png", preview: { kind: "unavailable", reason: "原文件不存在，请重新添加" } }]; s.notice = "图片加载失败样例：首次失败，点击重试后展示本地图片。" } },
  { id: "attachmentsMany", group: "附件", label: "20 个附件 · 布局边界", apply: (s: ChatSnapshot) => { s.attachments = Array.from({ length: 20 }, (_, i) => ({ id: `attachment${i}`, kind: "file", label: `src/components/WorkspacePanel${i + 1}.tsx`, preview: { kind: "none" } })); s.notice = "产品允许的 20 个附件上限，用于暴露窄栏布局边界。" } },
  { id: "reconnect", group: "状态", label: "断线 · 保留消息与重连", apply: (s: ChatSnapshot) => { s.phase = "disconnected"; s.notice = "连接已中断，请重新连接。已有记录由 Core 保存。" } },
  { id: "sending", group: "状态", label: "消息发送中", apply: (s: ChatSnapshot) => { s.phase = "sending"; s.messages = [...s.messages, { id: "pending", role: "user", label: "你", text: "继续检查错误恢复。" }] } },
  { id: "sendFailure", group: "状态", label: "发送失败 · 保留草稿", apply: (s: ChatSnapshot) => { s.notice = "发送失败，请稍后重试。输入内容已保留。（模拟）" } },
  { id: "historyEmpty", group: "历史", label: "历史 · 空列表", apply: (s: ChatSnapshot) => { s.history = { open: true, loading: false, hasMore: false, error: null, entries: [] } } },
  { id: "historyFailure", group: "历史", label: "历史 · 加载失败", apply: (s: ChatSnapshot) => { s.history = { open: true, loading: false, hasMore: false, error: "读取历史失败，请刷新重试。", entries: historyRows().slice(0, 3) } } },
  { id: "historyPaging", group: "历史", label: "历史 · 分页与归档", apply: (s: ChatSnapshot) => { s.history = { open: true, loading: false, hasMore: true, error: null, entries: historyRows() }; s.hasOlderMessages = true } },
  { id: "historyChanged", group: "历史", label: "历史 · 记录已变化", apply: (s: ChatSnapshot) => { s.historyNeedsRefresh = true; s.hasOlderMessages = false } },
  { id: "turnChanges", group: "资源", label: "轮次末尾 · 文件差异", apply: (s: ChatSnapshot) => {
    s.messages = [...s.messages.map(message => ({ ...message, turnId: "first" })), { id: "secondUser", turnId: "second", role: "user", label: "你", text: "继续补充登录校验。" }, { id: "secondTool", turnId: "second", role: "tool", label: "edit_file", text: "已写入部分修改，随后任务停止。", status: "interrupted", summary: "已停止" }, { id: "secondAnswer", turnId: "second", role: "assistant", label: "CodeM", text: "任务已停止，已写入的文件修改保留，可在下方逐段检查。" }, { id: "thirdUser", turnId: "third", role: "user", label: "你", text: "还有哪些需要测试？" }, { id: "thirdAnswer", turnId: "third", role: "assistant", label: "CodeM", text: "建议补充失败重试和取消操作。本轮只作说明，没有修改文件。" }]
    s.diffs = [
      { id: "firstDiff", turnId: "first", label: "src/login.ts", added: 42, removed: 17, preview: "complete", available: true },
      { id: "secondDiff", turnId: "second", label: "src/login.ts", added: 8, removed: 2, preview: "partial", available: true },
      { id: "thirdDiff", turnId: "second", label: "src/login.ts", added: 3, removed: 1, preview: "omitted", available: false },
    ]
  } },
  { id: "resourceFiles", group: "资源", label: "文件差异 · 多种预览", surface: "files", apply: (s: ChatSnapshot) => { s.diffs = (["complete", "partial", "binary", "omitted"] as const).map((preview, i) => ({ id: `diff${i}`, turnId: "previewTurn", available: true, label: ["src/login.ts", "src/components/authentication/AccountAuthorizationStatusAndRecoveryPanel.module.css", "assets/logo.png", "pnpm-lock.yaml"][i]!, added: i ? 18 : 42, removed: i ? 4 : 17, preview })) } },
  { id: "resourceTools", group: "资源", label: "MCP 与可用工具", surface: "tools", apply: (s: ChatSnapshot) => { s.mcpNames = ["design-preview", "docs-preview"]; s.tools = ["read_files", "write_file", "edit_file", "grep", "run_bash", "web_search", "web_fetch", "tool_search", "mcp__design__inspect", "mcp__docs__search"] } },
  { id: "resourceBackground", group: "资源", label: "后台终端与唤醒任务", surface: "background", apply: (s: ChatSnapshot) => { s.background = [{ id: "server", label: "预览服务 · localhost:4318", inProgress: true }, { id: "check", label: "类型检查", inProgress: false }]; s.backgroundTasks = (["queued", "started", "skipped", "cancelled", "notFound", "noop"] as const).map((phase, i) => ({ id: `task${i}`, label: `验证任务 ${i + 1}`, phase })) } },
  { id: "runtimeDetails", group: "运行详情", label: "计划 · 用量 · Hooks · 输出保护", surface: "capabilities", apply: (s: ChatSnapshot) => { s.capabilities = { activity: "正在验证交互状态（样例）", threadStatus: "idle", plan: [{ content: "检查依赖与运行环境", status: "completed" }, { content: "补齐展示场景", status: "in_progress" }, { content: "验证深浅主题与键盘操作", status: "pending" }], usage: { input: 18240, output: 3260, cacheRead: 12000, cacheWrite: null }, changes: [{ label: "tests/previewContent.ts", added: 128, removed: 12 }, { label: "docs/previewCoverage.md", added: 36, removed: 0 }], guards: [{ id: "guard", tool: "run_bash", status: "completed", returnedBytes: 4096, rawBytes: 18024, capped: true }], hooks: [{ id: "hook1", event: "before_tool", tool: "run_bash", outcome: "success", elapsedMs: 18 }, { id: "hook2", event: "after_tool", tool: null, outcome: "skipped", elapsedMs: 0 }] } } },
  { id: "commandFailure", group: "会话命令", label: "输入操作 · 失败保留草稿", apply: (s: ChatSnapshot) => { s.notice = "使用 /ask 或 /shell 提交输入，模拟失败后保留草稿。" } },
  { id: "sessionManage", group: "会话命令", label: "当前会话重命名", surface: "sessionTools", apply: (s: ChatSnapshot) => { s.history.entries = historyRows(); s.sessionTools.directories = [{ id: "components", label: "shared-components" }, { id: "docs", label: "project-docs" }] } },
  { id: "sessionDirectories", group: "会话命令", label: "额外工作目录", surface: "sessionTools", apply: (s: ChatSnapshot) => { s.sessionTools.directories = [{ id: "components", label: "shared-components" }, { id: "docs", label: "project-docs" }] } },
  { id: "sideQuestionRunning", group: "会话命令", label: "旁路提问 · 回答中", surface: "sessionTools", apply: (s: ChatSnapshot) => { s.phase = "sideQuestion"; s.sessionTools.sideQuestion = { question: "这里的目录附件是否授予访问权限？", answer: "目录附件与额外工作目录分别处理。当前正在整理说明…", status: "running" } } },
  { id: "sideQuestionFailed", group: "会话命令", label: "旁路提问 · 失败与部分回答", surface: "sessionTools", apply: (s: ChatSnapshot) => { s.sessionTools.sideQuestion = { question: "哪些场景还没有覆盖？", answer: "已确认图片异常、历史翻页和长内容需要独立样例。\n连接随后中断，回答尚未完成。", status: "failed" }; s.notice = "旁路提问失败，主对话记录仍保留。" } },
  { id: "catalogLoading", group: "能力目录", label: "目录 · 加载中", surface: "sessionTools", apply: (s: ChatSnapshot) => { s.sessionTools.busy = "loadCatalog" } },
  { id: "catalogEmpty", group: "能力目录", label: "目录 · 空结果", surface: "sessionTools", apply: (s: ChatSnapshot) => { s.sessionTools.catalog = { kind: "skills", loaded: true, stale: false, rows: [] } } },
  { id: "catalogStale", group: "能力目录", label: "目录 · 过期与失败", surface: "sessionTools", apply: (s: ChatSnapshot) => { s.sessionTools.catalog = { kind: "skills", loaded: true, stale: true, rows: catalogSamples.skills }; s.notice = "目录刷新失败，保留上次结果；可以重试。" } },
  ...catalogDefinitions.map(([id, label, kind]) => ({ id, group: "能力目录", label, surface: "sessionTools" as const, apply: (s: ChatSnapshot) => { applyPreviewCatalog(s, kind) } })),
  { id: "questionLong", group: "交互", label: "长问题 · 多选与草稿", panel: longPanel, apply: (s: ChatSnapshot) => { s.phase = "running" } },
  { id: "planLong", group: "交互", label: "长计划 · 修改意见", panel: { ...longPanel, id: "longPlan", kind: "plan", title: "审阅完整实现计划", description: "阅读计划后批准，或提供修改意见。", detail: "# 场景补齐计划\n\n" + Array.from({ length: 20 }, (_, i) => `## 第 ${i + 1} 项\n检查首次进入、重复操作、取消、失败与重载。\n`).join("\n"), multiple: false, initialText: "请优先覆盖错误恢复。", choices: [{ id: "approve", label: "同意", description: "按计划继续", selected: false }, { id: "decline", label: "拒绝", description: "提交修改意见", selected: false }], confirmLabel: null }, apply: (s: ChatSnapshot) => { s.phase = "running" } },
  { id: "rewind", group: "交互", label: "回退 · 检查点选择", panel: rewindPanel, apply: (s: ChatSnapshot) => { s.phase = "configuring" } },
] as const satisfies readonly ContentScenario[]

export function contentScenario(id: string): ContentScenario | undefined { return contentScenarios.find(item => item.id === id) }
