import type {
  AppServerBackgroundTerminalClean,
  AppServerBackgroundTerminalList,
  AppServerConfigSnapshot,
  AppServerEnvironmentInfo,
  AppServerHookList,
  AppServerLoadedThreads,
  AppServerModelProviderCapabilities,
  AppServerPermissionProfile,
  AppServerPluginList,
  AppServerToolList,
} from "@codem/app-server"
import type {
  CodemCommandResult,
  CodemConfigSnapshot,
  CodemEnvironmentInfo,
  CodemHookList,
  CodemJsonValue,
  CodemLoadedThreads,
  CodemModelCatalog,
  CodemModelProviderCapabilities,
  CodemPermissionMode,
  CodemPermissionProfile,
  CodemPluginList,
  CodemSkillSummary,
  CodemToolList,
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

const SENSITIVE_CONFIG_KEYS = new Set([
  "cwd",
  "path",
  "directory",
  "directories",
  "filepath",
  "filename",
  "file",
  "logpath",
  "logfile",
  "home",
  "shell",
  "env",
  "environment",
  "workdir",
  "workingdirectory",
  "additionaldirectories",
  "log",
])

/** environment/info：只拷 agent 名/版本与 os/arch。 */
export function copyEnvironmentInfo(info: AppServerEnvironmentInfo): CodemEnvironmentInfo {
  return {
    agentName: info.agentName,
    agentVersion: info.agentVersion,
    os: info.os,
    arch: info.arch,
  }
}

/** config/read：再剥一层路径键和绝对路径字符串。密钥已由 Host 置空。 */
export function copyConfigSnapshot(snapshot: AppServerConfigSnapshot): CodemConfigSnapshot {
  return {
    writable: snapshot.writable,
    writeOwner: snapshot.writeOwner,
    config: copyJsonObject(snapshot.config),
  }
}

export function copyHookList(list: AppServerHookList): CodemHookList {
  const hooks: { [eventName: string]: readonly { readonly command: string; readonly matcher: string | null }[] } = {}
  for (const [eventName, handlers] of Object.entries(list.hooks)) {
    hooks[eventName] = handlers.map((handler) => ({
      command: copyCommandLabel(handler.command),
      matcher: handler.matcher,
    }))
  }
  return { hooks }
}

/** plugin/list：只拷名称，丢弃可能含路径的元数据。 */
export function copyPluginList(list: AppServerPluginList): CodemPluginList {
  return {
    installed: Object.keys(list.installed),
    marketplaces: Object.keys(list.marketplaces),
  }
}

export function copyPermissionProfiles(
  profiles: readonly AppServerPermissionProfile[],
): readonly CodemPermissionProfile[] {
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    description: profile.description,
    settableAtRuntime: profile.settableAtRuntime,
  }))
}

export function copyModelProviderCapabilities(
  capabilities: AppServerModelProviderCapabilities,
): CodemModelProviderCapabilities {
  return {
    version: capabilities.version,
    askUser: { ...capabilities.askUser },
    custom: { ...capabilities.custom },
  }
}

export function copyToolList(list: AppServerToolList): CodemToolList {
  return {
    threadId: list.threadId,
    model: list.model,
    tools: [...list.tools],
  }
}

export function copyLoadedThreads(list: AppServerLoadedThreads): CodemLoadedThreads {
  return { threadIds: [...list.threadIds] }
}

/** 后台终端：只拷 processId / inProgress，丢掉 logPath。 */
export function copyBackgroundTerminals(list: AppServerBackgroundTerminalList) {
  return {
    terminals: list.terminals.map((terminal) => ({
      processId: terminal.processId,
      inProgress: terminal.inProgress,
    })),
  }
}

export function copyBackgroundTerminalClean(result: AppServerBackgroundTerminalClean) {
  return { processIds: result.results.map((entry) => entry.processId) }
}

export function controlResultMessage<Type extends ExtensionMessage["type"], T extends object>(
  type: Type,
  requestID: string,
  result: CodemCommandResult<T>,
  sessionID?: string,
): Extract<ExtensionMessage, { readonly type: Type }> {
  return {
    type,
    requestID,
    result,
    ...(sessionID === undefined ? {} : { sessionID }),
  } as Extract<ExtensionMessage, { readonly type: Type }>
}

function copyJsonObject(value: { readonly [key: string]: unknown }): { readonly [key: string]: CodemJsonValue } {
  const copied: { [key: string]: CodemJsonValue } = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveConfigKey(key)) continue
    copied[key] = copyJsonValue(entry)
  }
  return copied
}

function copyJsonValue(value: unknown): CodemJsonValue {
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid CodeM config number")
    return value
  }
  if (typeof value === "string") return looksLikeFilesystemPath(value) ? null : value
  if (Array.isArray(value)) return value.map((entry) => copyJsonValue(entry))
  if (typeof value === "object") return copyJsonObject(value as { readonly [key: string]: unknown })
  throw new Error("Invalid CodeM JSON value")
}

function isSensitiveConfigKey(key: string): boolean {
  return SENSITIVE_CONFIG_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""))
}

function looksLikeFilesystemPath(value: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value)
}

/** 绝对路径只保留最后一段，避免把工作区路径送进 Webview。 */
function copyCommandLabel(command: string): string {
  if (!looksLikeFilesystemPath(command)) return command
  const parts = command.split(/[\\/]/u)
  return parts[parts.length - 1] || "command"
}
