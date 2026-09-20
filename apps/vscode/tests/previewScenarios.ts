import type { ChatSnapshot } from "../src/shared/messages.ts"
import { contentScenarios } from "./previewContent.ts"

export const previewScenarios = [
  ["accountAvatar", "账户", "账户头像"], ["accountAvatarFailure", "账户", "头像加载失败"],
  ["accountSignedOut", "账户", "未登录"], ["accountSigningIn", "账户", "浏览器登录中"], ["accountFailure", "账户", "登录失败"], ["accountSignOutFailure", "账户", "退出失败与重试"], ["accountProfile", "账户", "个人账户"],
  ["conversation", "对话", "完成回复"], ["progressUpdates", "对话", "多次搜索与进度说明"], ["welcome", "对话", "新会话"], ["codeSelection", "输入", "代码选区"], ["codeSelectionFailure", "输入", "代码选区 · 发送失败"],
  ["disconnected", "状态", "未连接"], ["connecting", "状态", "首次发送 · 连接准备"],
  ["firstSend", "状态", "首次发送 · 慢连接交互"],
  ["waitingForHost", "状态", "首屏 · 宿主尚未响应"],
  ["thinking", "状态", "思考中"], ["tools", "状态", "工具执行中"],
  ["failed", "状态", "工具失败"], ["stopping", "状态", "正在停止"],
  ["historyLoading", "状态", "历史恢复中"], ["history", "对话", "历史会话列表"],
  ["space", "菜单", "空间选择"], ["model", "菜单", "模型选择"],
  ["effort", "菜单", "思考强度"], ["workMode", "菜单", "工作模式"],
  ["permissionDefault", "菜单", "权限 · 默认"], ["permissionAuto", "菜单", "权限 · 自动审批"], ["permissionYolo", "菜单", "权限 · 完全访问"],
  ["approval", "交互", "命令审批"], ["question", "交互", "多选问题"], ["questionBack", "交互", "第二题 · 返回与提交"], ["plan", "交互", "计划确认"],
  ["attachments", "内容", "文件与图片附件"], ["artifacts", "内容", "产物卡片"],
  ...contentScenarios.map(({ id, group, label }) => [id, group, label] as const),
] as const

export function applyPreviewScenario(state: ChatSnapshot, scenario: string): string | null {
  const empty = () => { state.messages = []; state.threadId = null }
  if (scenario === "progressUpdates") state.messages = [
    { id: "u", role: "user", label: "你", text: "今天本地新闻" },
    { id: "r1", role: "reasoning", label: "思考过程", text: "先确定查询范围。", summary: "分析查询范围", status: "completed" },
    { id: "t1", role: "tool", label: "web_search", details: { kind: "search", code: null, fields: [{ label: "查询", value: "国内 今日要闻" }] }, text: "已返回第一轮结果。", summary: "", status: "completed" },
    { id: "p1", role: "assistant", label: "CodeM", text: "暂未获取城市，先检索国内要闻。" },
    { id: "t2", role: "tool", label: "web_search", details: { kind: "search", code: null, fields: [{ label: "查询", value: "今日 新闻汇总" }] }, text: "已返回第二轮结果。", summary: "", status: "completed" },
    { id: "p2", role: "assistant", label: "CodeM", text: "第一轮结果多为网站首页，正在调整关键词。" },
    { id: "t3", role: "tool", label: "整理来源", text: "来源整理完成。", summary: "", status: "completed" },
    { id: "a", role: "assistant", label: "CodeM", text: "已完成新闻检索。提供所在城市后，可以继续筛选本地消息。\n\n这是界面预览示例，不是真实新闻。" },
  ]
  if (scenario === "welcome" || scenario.startsWith("account")) empty()
  if (scenario === "disconnected" || scenario === "connecting") { empty(); state.phase = scenario; state.space = null; state.workspace = null; state.model = null }
  if (scenario === "firstSend") { empty(); state.phase = "disconnected"; state.space = null; state.workspace = null; state.model = null }
  if (scenario === "historyLoading") state.phase = "loadingHistory"
  if (scenario === "history") state.history = { open: true, loading: false, hasMore: true, error: null, entries: ["整理登录页面", "检查工作区文件", "优化聊天交互"].map((title, i) => ({ id: `preview${i}`, title, startedAt: new Date(Date.now() - i * 86400000).toISOString(), turnCount: i + 1, archived: false })) }
  if (["thinking", "tools", "failed", "stopping"].includes(scenario)) {
    state.messages = state.messages.slice(0, scenario === "thinking" ? 2 : 3)
    state.phase = scenario === "failed" ? "ready" : scenario === "stopping" ? "stopping" : "running"
    const activity = state.messages.at(-1)!
    if (activity.role === "reasoning" || activity.role === "tool") {
      activity.status = scenario === "failed" ? "failed" : "running"
      activity.summary = scenario === "failed" ? "类型检查失败" : scenario === "thinking" ? "正在分析实现方案" : "正在运行类型检查"
      if (activity.role === "tool") { activity.label = "run_bash"; activity.details = { kind: "command", fields: [{ label: "工作目录", value: "workspace" }], code: "pnpm typecheck" }; activity.text = scenario === "failed" ? "src/main.ts:12 — 类型不匹配，请检查参数。" : "正在检查项目类型…" }
    }
    if (scenario === "failed") state.notice = "本轮任务失败，可以继续发送消息。"
  }
  if (scenario === "attachments") {
    empty()
    state.attachments = [{ id: "previewFile", label: "src/main.ts", kind: "file", preview: { kind: "none" } }, { id: "previewImage", label: "设计参考.png", kind: "image", preview: { kind: "image", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=" } }]
  }
  if (scenario === "artifacts") state.messages = [state.messages[0]!, { id: "artifacts", role: "assistant", label: "CodeM", text: "已完成页面整理，产物如下。", artifacts: [
    { id: "file", kind: "file", title: "实现说明.md", detail: "docs/实现说明.md", available: true },
    { id: "diff", kind: "diff", title: "登录页面修改", detail: "+24 −8", available: true },
    { id: "chart", kind: "chart", title: "检查结果", detail: "只读数据预览", available: true },
  ] }]
  if (scenario.startsWith("permission")) {
    empty(); state.permission = scenario === "permissionYolo" ? "yolo" : scenario === "permissionAuto" ? "auto" : "default"
    state.phase = "ready"; return "permissionMode"
  }
  if (scenario === "effort") { empty(); state.phase = "disconnected"; return "effort" }
  if (["space", "model", "workMode"].includes(scenario)) { empty(); state.phase = "ready"; return scenario }
  if (["approval", "question", "questionBack", "plan"].includes(scenario)) { state.messages = state.messages.slice(0, 1); state.phase = "running"; return scenario }
  return null
}
