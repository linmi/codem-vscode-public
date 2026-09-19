/**
 * `@codem/protocol` public surface (physical path: packages/protocol).
 * Catalog, thread-mode, and Host-control DTOs that Webview may see.
 * Do not add leftover OpenCode HttpApi, App Server Host APIs, Node, VS Code, Electron, or DOM.
 * Shapes are handwritten and aligned with this repo's CodeM App Server catalog / control-plane DTO.
 * Host copies only these fields; it must not forward raw frames, secrets, paths, or process handles.
 */

/** Core permission modes that Webview may display or request. */
export type CodemPermissionMode = "default" | "auto" | "yolo"

/** Core work mode on a live thread. Distinct from Host thread-settings `default`/`plan`. */
export type CodemWorkMode = "normal" | "plan"

/** Thread-mode DTO posted on `threadModesChanged` / `threadModesResult`. */
export interface CodemModeState {
  readonly revision: number
  readonly permissionEpoch: number
  readonly permissionMode: CodemPermissionMode
  readonly workMode: CodemWorkMode
}

/**
 * Narrow an unknown picker value to a permission mode.
 * Isomorphic on purpose so Webview does not import `@codem/app-server`.
 */
export function parseCodemPermissionMode(value: unknown): CodemPermissionMode {
  if (value !== "default" && value !== "auto" && value !== "yolo") {
    throw new Error(`Invalid CodeM permissionMode: ${String(value)}`)
  }
  return value
}

/** Catalog row posted on `codemModelsLoaded`. No paths or secrets. */
export interface CodemModelSummary {
  readonly id: string
  readonly source: string
  readonly contextWindowTokens: number
  readonly supportsVision: boolean
}

/** Skill row posted on `codemSkillsLoaded`. Name and description only. */
export interface CodemSkillSummary {
  readonly name: string
  readonly description: string
}

/** Builtin reasoning-effort ids shown by the model picker. */
export const CODEM_BUILTIN_INTELLIGENCE_TIERS = ["low", "medium", "high", "xhigh"] as const

export type CodemBuiltinIntelligence = (typeof CODEM_BUILTIN_INTELLIGENCE_TIERS)[number]

export interface CodemModelCatalog {
  readonly activeModel: string
  readonly models: readonly CodemModelSummary[]
}

/** Finite JSON that Webview may store. Host strips secrets and filesystem paths before copy. */
export type CodemJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CodemJsonValue[]
  | { readonly [key: string]: CodemJsonValue }

/**
 * environment/info 白名单。不含 cwd / shell / 环境变量。
 * Posted on `environmentInfoLoaded`.
 */
export interface CodemEnvironmentInfo {
  readonly agentName: string
  readonly agentVersion: string
  readonly os: string
  readonly arch: string
}

/**
 * config/read 去密钥快照，不是 Kilo Config，也没有 configWrite。
 * Posted on `configSnapshotLoaded`.
 */
export interface CodemConfigSnapshot {
  readonly writable: boolean
  readonly writeOwner: string
  readonly config: { readonly [key: string]: CodemJsonValue }
}

/** hooks/list 行：事件名 + 命令标识 + matcher。不含工作区路径。 */
export interface CodemHookHandler {
  readonly command: string
  readonly matcher: string | null
}

export interface CodemHookList {
  readonly hooks: { readonly [eventName: string]: readonly CodemHookHandler[] }
}

/** plugin/list 只下发已安装 / marketplace 名称，不转发元数据里的路径或密钥。 */
export interface CodemPluginList {
  readonly installed: readonly string[]
  readonly marketplaces: readonly string[]
}

/** permissionProfile/list 行。现有选择器只消费 default/auto/yolo。 */
export interface CodemPermissionProfile {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly settableAtRuntime: boolean
}

/** modelProvider/capabilities/read。布尔能力位，不含凭证。 */
export interface CodemModelProviderCapabilities {
  readonly version: string
  readonly askUser: { readonly [capability: string]: boolean }
  readonly custom: { readonly [capability: string]: boolean }
}

/** tools/list。线程已加载后的工具名表。 */
export interface CodemToolList {
  readonly threadId: string
  readonly model: string
  readonly tools: readonly string[]
}

/** thread/loaded/list。仅线程 id，不是 CLI broker 空间表。 */
export interface CodemLoadedThreads {
  readonly threadIds: readonly string[]
}

/**
 * backgroundTerminals 行。processId ≠ background taskId。
 * 不含 logPath / cwd / 进程句柄。
 */
export interface CodemBackgroundTerminal {
  readonly processId: number
  readonly inProgress: boolean
}

export interface CodemBackgroundTerminalList {
  readonly terminals: readonly CodemBackgroundTerminal[]
}

export interface CodemBackgroundTerminalClean {
  readonly processIds: readonly number[]
}

/**
 * Core `space/list` 空注入快照。不是 CLI broker / `project_list`，
 * 也不是空间写入权威；选择器仍走 broker。
 * Posted on `coreSpaceSnapshotLoaded`.
 */
export interface CodemCoreSpace {
  readonly projectKey: string
  readonly displayName: string
}

export interface CodemCoreSpaceSnapshot {
  readonly current: CodemCoreSpace | null
  readonly spaces: readonly CodemCoreSpace[]
}

/** 实时 `thread/turns/list` 行。不是 JSONL 历史，不能替代 `loadMessages`。 */
export interface CodemLiveTurn {
  readonly id: string
  readonly status: string | null
  readonly startedAt: string | null
}

/**
 * 实时 `thread/items/list` 白名单行。
 * 不含 input / output / text / finalAnswer，避免把路径或密钥送进 Webview。
 */
export interface CodemLiveItem {
  readonly id: string
  readonly type: string
  readonly status: string
  readonly callId: string | null
  readonly toolName: string | null
  readonly label: string
  readonly isError: boolean
  readonly subagentId: string | null
  readonly subagentKind: string | null
}

/** 实时分页。`entries` 不是 transcript store。 */
export interface CodemLivePage<T> {
  readonly entries: readonly T[]
  readonly nextCursor: string | null
  readonly total: number
}

/**
 * 最近一次 `thread/tokenUsage/updated`。
 * `durable: false`：不是 JSONL / Kilo sessionModelUsage 账单。
 * Posted on `liveThreadUsageLoaded`.
 */
export interface CodemLiveUsageSnapshot {
  readonly durable: false
  readonly observed: boolean
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cacheReadTokens: number | null
  readonly cacheCreationTokens: number | null
}

/** 带 requestID 的 CodeM 控制面结果：成功载荷或失败原因，互斥。 */
export type CodemCommandResult<T extends object> = T | { readonly error: string }
