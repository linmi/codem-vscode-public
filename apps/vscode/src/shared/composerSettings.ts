import { parseCodemIntelligence, parseCodemPermissionMode, type CodemBuiltinIntelligence, type CodemPermissionMode } from "@codem/protocol"

export const workModes = [
  { value: "default", label: "Agent", description: "执行任务" },
  { value: "plan", label: "Plan", description: "先制定计划" },
] as const
export const permissions = [
  { value: "default", label: "默认权限", description: "遵循 Core 默认审批策略" },
  { value: "auto", label: "自动审批", description: "由 Core 自动评估工具权限" },
  { value: "yolo", label: "完全访问", description: "跳过工具权限审批" },
] as const
export type LocalComposerSettings = { intelligence: CodemBuiltinIntelligence; workMode: "default" | "plan"; permissionMode: CodemPermissionMode }
export type ComposerSettingAction = { type: "setEffort"; effort: CodemBuiltinIntelligence } | { type: "setWorkMode"; workMode: LocalComposerSettings["workMode"] } | { type: "setPermission"; permission: CodemPermissionMode }
export function parseWorkMode(value: unknown): LocalComposerSettings["workMode"] {
  if (value !== "default" && value !== "plan") throw new Error("Invalid CodeM work mode")
  return value
}
export function settingPatch(action: ComposerSettingAction): Partial<LocalComposerSettings> {
  switch (action.type) {
    case "setEffort": return { intelligence: parseCodemIntelligence(action.effort) }
    case "setWorkMode": return { workMode: parseWorkMode(action.workMode) }
    case "setPermission": return { permissionMode: parseCodemPermissionMode(action.permission) }
  }
}
export interface ComposerChoice { id: string; label: string; description: string; selected: boolean }
export interface ComposerCatalog { models: readonly ComposerChoice[]; spaces: readonly ComposerChoice[] }
