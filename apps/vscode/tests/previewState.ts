import { initialSnapshot, type ChatSnapshot } from "../src/shared/messages.ts"
import { applyPreviewScenario, previewScenarios } from "./previewScenarios.ts"
import { panelFixtures } from "./panelFixtures.ts"
import { contentScenario } from "./previewContent.ts"

export const localMenuNames = ["effort", "workMode", "permissionMode", "model", "space"]
const fixture: ChatSnapshot = {
  ...initialSnapshot(), phase: "ready", workspace: "codem-plugin", space: "研发团队", model: "Auto", threadId: "preview",
  composerCatalog: {
    models: [{ id: "auto", label: "Auto", description: "", selected: true }, { id: "model-one", label: "CodeM Reasoning", description: "支持图片", selected: false }, { id: "model-two", label: "CodeM Fast", description: "", selected: false }],
    spaces: [{ id: "team", label: "研发团队", description: "", selected: true }, { id: "personal", label: "个人空间", description: "", selected: false }],
  },
  messages: [
    { id: "u", role: "user", label: "你", text: "帮我整理登录页面，让状态反馈更清晰。" },
    { id: "r", role: "reasoning", label: "分析登录流程", status: "completed", summary: "检查了登录状态与页面布局", text: "先确认登录、等待授权和已连接三种状态，避免按钮含义重叠。" },
    { id: "t", role: "tool", label: "读取文件 · auth.ts", status: "completed", summary: "已读取 2 个相关文件", text: "src/auth.ts\nsrc/login.ts" },
    { id: "a", role: "assistant", label: "CodeM", text: "## 登录页面\n\n已经整理好状态反馈：\n\n- 明确区分 **未登录**、**等待授权** 和 **已连接**。\n- 取消授权会保留输入内容，可以随时重试。\n\n```ts\nconst status = await readAuthStatus()\nrenderAccount(status)\n```\n\n浏览器授权后会回到当前会话。" },
  ],
}

export type PreviewSearch = { scenario: typeof previewScenarios[number][0]; theme: "light" | "dark"; panel?: string; empty?: string }
export function parsePreviewSearch(search: Record<string, unknown>): PreviewSearch {
  const scenario = search.scenario ?? "conversation"
  const theme = search.theme ?? "light"
  if (!previewScenarios.some(item => item[0] === scenario)) throw new Error("未知预览场景")
  if (theme !== "light" && theme !== "dark") throw new Error("未知预览主题")
  if (search.panel !== undefined && (typeof search.panel !== "string" || (!localMenuNames.includes(search.panel) && !Object.hasOwn(panelFixtures, search.panel)))) throw new Error("未知预览面板")
  return { scenario: scenario as PreviewSearch["scenario"], theme, ...(typeof search.panel === "string" ? { panel: search.panel } : {}), ...(search.empty !== undefined ? { empty: String(search.empty) } : {}) }
}
export function createPreviewState(search: PreviewSearch) {
  const demo = structuredClone(fixture)
  const panels = structuredClone(panelFixtures)
  if (search.empty !== undefined) { demo.messages = []; demo.threadId = null }
  const panelName = applyPreviewScenario(demo, search.scenario) ?? search.panel
  const content = contentScenario(search.scenario)
  content?.apply(demo)
  const activePanel = content?.panel ? structuredClone(content.panel) : panelName && !localMenuNames.includes(panelName) ? panels[panelName] : null
  if (demo.phase === "disconnected") demo.composerCatalog = { models: [], spaces: [] }
  if (demo.messages.length) {
    const turnId = "previewTurn"
    demo.messages = demo.messages.map(message => ({ ...message, turnId: message.turnId ?? turnId }))
    const now = Date.now()
    demo.turnTimings = [...new Set(demo.messages.map(message => message.turnId!))].map(turnId => ({ turnId, startedAt: now - 36_000, finishedAt: ["running", "stopping"].includes(demo.phase) ? null : now }))
  }
  return { demo, panels, activePanel, surface: panelName && localMenuNames.includes(panelName) ? panelName : content?.surface ?? null }
}
