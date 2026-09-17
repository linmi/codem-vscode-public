import type { AppServerPermissionProfile } from "@codem/app-server"
import type {
  CodemModelCatalog,
  CodemPermissionMode,
  CodemSkillSummary,
} from "@codem/protocol"
import type { ExtensionMessage } from "../../../webview-ui/src/types/messages/extension-messages"

/**
 * Extension→Webview 白名单拷贝。类型来自 `@codem/protocol`，
 * 不在 Host 再定一套并行 interface，也不转发 raw frame、密钥或路径。
 */

export function codemModelsLoadedMessage(
  catalog: CodemModelCatalog,
): Extract<ExtensionMessage, { readonly type: "codemModelsLoaded" }> {
  return {
    type: "codemModelsLoaded",
    catalog: {
      activeModel: catalog.activeModel,
      models: catalog.models.map((model) => ({
        id: model.id,
        source: model.source,
        contextWindowTokens: model.contextWindowTokens,
        supportsVision: model.supportsVision,
      })),
    },
  }
}

export function codemSkillsLoadedMessage(
  skills: readonly CodemSkillSummary[],
): Extract<ExtensionMessage, { readonly type: "codemSkillsLoaded" }> {
  return {
    type: "codemSkillsLoaded",
    skills: skills.map((skill) => ({ name: skill.name, description: skill.description })),
  }
}

/**
 * 权限档只用来校验写入，不投影成 agentsLoaded。
 * Core 未枚举的 typed mode 仍按现有 default/auto/yolo 契约放行。
 */
export function assertPermissionModeSettable(
  profiles: readonly AppServerPermissionProfile[],
  mode: CodemPermissionMode,
): void {
  const profile = profiles.find((entry) => entry.id === mode)
  if (profile && !profile.settableAtRuntime) {
    throw new Error(`CodeM permission mode ${mode} is not settable at runtime`)
  }
}
