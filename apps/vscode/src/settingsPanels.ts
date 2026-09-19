import { APP_SERVER_BUILTIN_INTELLIGENCE_TIERS, DEFAULT_APP_SERVER_THREAD_SETTINGS, type AppServerThreadSettings } from "@codem/app-server"
import type { ChatSession } from "./chatController.ts"
import type { PanelBroker } from "./panelBroker.ts"

export async function selectSettings(kind: "selectModel" | "selectEffort" | "selectPermission" | "selectWorkMode", settings: AppServerThreadSettings, session: Pick<ChatSession, "models">, panels: PanelBroker, signal: AbortSignal): Promise<AppServerThreadSettings | null> {
  if (kind === "selectModel") {
    const answer = await panels.request({ kind: "model", title: "模型", choices: session.models.map(model => ({ value: model.id, label: model.id.endsWith("/auto") ? "Auto" : model.id, description: `${model.id} · ${model.supportsVision ? "支持图片 · " : ""}${model.contextWindowTokens.toLocaleString()} tokens`, selected: settings.model === model.id })) }, signal)
    return answer ? { ...settings, model: answer.values[0]! } : null
  }
  if (kind === "selectEffort") {
    const labels = { low: "Low", medium: "Medium", high: "High", xhigh: "Max" } as const
    const answer = await panels.request({ kind: "effort", title: "思考强度", choices: APP_SERVER_BUILTIN_INTELLIGENCE_TIERS.map(value => ({ value, label: labels[value], description: value === DEFAULT_APP_SERVER_THREAD_SETTINGS.intelligence ? "Default" : "", selected: settings.intelligence === value })) }, signal)
    return answer ? { ...settings, intelligence: answer.values[0]! } : null
  }
  if (kind === "selectWorkMode") {
    const answer = await panels.request({ kind: "workMode", title: "工作模式", choices: [{ value: "default" as const, label: "Agent", description: "执行任务", selected: settings.workMode === "default" }, { value: "plan" as const, label: "Plan", description: "先制定计划", selected: settings.workMode === "plan" }] }, signal)
    return answer ? { ...settings, workMode: answer.values[0]! } : null
  }
  const answer = await panels.request({ kind: "permissionMode", title: "权限模式", choices: [
    { value: "default" as const, label: "默认权限", description: "遵循 Core 默认审批策略", selected: settings.permissionMode === "default" },
    { value: "auto" as const, label: "自动审批", description: "由 Core 自动评估工具权限", selected: settings.permissionMode === "auto" },
    { value: "yolo" as const, label: "完全访问", description: "跳过工具权限审批", selected: settings.permissionMode === "yolo" },
  ] }, signal)
  if (!answer) return null
  if (answer.values[0] === "yolo" && settings.permissionMode !== "yolo") {
    const confirmation = await panels.request({ kind: "approval", title: "启用完全访问？", description: "任务将跳过工具权限审批执行操作。仅对你信任的任务启用。", choices: [{ value: false, label: "保持当前权限" }, { value: true, label: "启用完全访问" }] }, signal)
    if (!confirmation?.values[0]) return null
  }
  return { ...settings, permissionMode: answer.values[0]! }
}
