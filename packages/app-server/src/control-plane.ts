import { parseAppServerItem, type AppServerItem, type AppServerJsonValue } from "./items.ts"
import type { JsonObject } from "./rpc.ts"

/**
 * Core 0.8.37 App Server 已声明、但原先未进入 Host 的控制面 / 线程扩展 RPC。
 * 方法名来自 pinned Core 分发表与 initialize 能力位，不 invent 额外协议。
 */
export const APP_SERVER_CONTROL_PLANE_METHODS = [
  "environment/info",
  "config/read",
  "hooks/list",
  "plugin/list",
  "permissionProfile/list",
  "space/list",
  "modelProvider/capabilities/read",
  "tools/list",
  "thread/loaded/list",
  "thread/shellCommand",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/terminate",
  "thread/backgroundTerminals/clean",
  "thread/clear",
  "thread/turns/list",
  "thread/items/list",
] as const

/** Host 已理解的 Core 通知。未知 method 必须 fail closed，不能静默丢弃。 */
export const APP_SERVER_KNOWN_NOTIFICATIONS = [
  "warning",
  "auth/invalidated",
  "skills/changed",
  "thread/started",
  "thread/cleared",
  "thread/closed",
  "thread/archived",
  "thread/deleted",
  "thread/name/updated",
  "thread/unarchived",
  "thread/status/changed",
  "thread/mode/changed",
  "thread/tokenUsage/updated",
  "thread/sideQuestion/started",
  "thread/sideQuestion/delta",
  "thread/sideQuestion/completed",
  "serverRequest/resolved",
  "turn/started",
  "turn/activity",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/subagent/progress",
  "item/toolCall/progress",
  "item/toolCall/guardUpdated",
  "item/fileChange/delta",
  "hook/completed",
  "backgroundTask/wakeQueued",
  "backgroundTask/wakeStarted",
  "backgroundTask/wakeSkipped",
] as const

const SECRET_CONFIG_KEYS = new Set([
  "apikey",
  "api_key",
  "secret",
  "token",
  "password",
  "credential",
  "authorization",
  "access_token",
  "refresh_token",
])

export function isAppServerKnownNotification(method: string): boolean {
  return (APP_SERVER_KNOWN_NOTIFICATIONS as readonly string[]).includes(method)
}

export interface AppServerEnvironmentInfo {
  readonly agentName: string
  readonly agentVersion: string
  readonly arch: string
  readonly cwd: string
  readonly os: string
  readonly shell: string
}

export interface AppServerConfigSnapshot {
  readonly writable: boolean
  readonly writeOwner: string
  readonly config: { readonly [key: string]: AppServerJsonValue }
}

export interface AppServerHookHandler {
  readonly command: string
  readonly matcher: string | null
}

export interface AppServerHookList {
  readonly cwd: string
  readonly hooks: { readonly [eventName: string]: readonly AppServerHookHandler[] }
}

export interface AppServerPluginList {
  readonly installed: { readonly [name: string]: { readonly [key: string]: AppServerJsonValue } }
  readonly marketplaces: { readonly [name: string]: { readonly [key: string]: AppServerJsonValue } }
}

export interface AppServerPermissionProfile {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly settableAtRuntime: boolean
}

/** Core `space/list` 快照，不是 CLI broker 的空间权威。 */
export interface AppServerCoreSpaceSnapshot {
  readonly current: AppServerCoreSpace | null
  readonly spaces: readonly AppServerCoreSpace[]
}

export interface AppServerCoreSpace {
  readonly projectKey: string
  readonly displayName: string
}

export interface AppServerModelProviderCapabilities {
  readonly version: string
  readonly askUser: { readonly [capability: string]: boolean }
  readonly custom: { readonly [capability: string]: boolean }
}

export interface AppServerToolList {
  readonly threadId: string
  readonly model: string
  readonly tools: readonly string[]
}

export interface AppServerLoadedThreads {
  readonly threadIds: readonly string[]
}

/** logPath 只留在 Host；编辑器不得转发给 Webview。 */
export interface AppServerBackgroundTerminal {
  readonly processId: number
  readonly logPath: string
  readonly inProgress: boolean
}

export interface AppServerBackgroundTerminalList {
  readonly cwd: string
  readonly terminals: readonly AppServerBackgroundTerminal[]
}

export interface AppServerBackgroundTerminalClean {
  readonly cwd: string
  readonly results: readonly { readonly processId: number }[]
}

export interface AppServerThreadModelSelection {
  readonly id: string
  readonly intelligence: string
}

/** 实时 Core 快照，不是 JSONL 历史权威。 */
export interface AppServerLiveTurn {
  readonly id: string
  readonly status: string | null
  readonly startedAt: string | null
}

/** Snapshot-only acceptance record; not a streamed AppServerItem or terminal event. */
export interface AppServerSteerAcceptedItem {
  readonly id: string
  readonly type: "steerAccepted"
  readonly status: "completed"
  readonly mode: string
  readonly recordSeq: number
  readonly text: string
}
export type AppServerLiveItem = AppServerItem | AppServerSteerAcceptedItem

export interface AppServerLivePage<T> {
  readonly entries: readonly T[]
  readonly nextCursor: number | null
  readonly total: number
}

export function parseAppServerEnvironmentInfo(value: unknown, label: string): AppServerEnvironmentInfo {
  const result = objectValue(value, label)
  const agent = objectValue(result.agent, `${label} agent`)
  return {
    agentName: nonBlankString(agent.name, `${label} agent.name`),
    agentVersion: nonBlankString(agent.version, `${label} agent.version`),
    arch: nonBlankString(result.arch, `${label} arch`),
    cwd: nonBlankString(result.cwd, `${label} cwd`),
    os: nonBlankString(result.os, `${label} os`),
    shell: nonBlankString(result.shell, `${label} shell`),
  }
}

export function parseAppServerConfigSnapshot(value: unknown, label: string): AppServerConfigSnapshot {
  const result = objectValue(value, label)
  return {
    writable: booleanValue(result.writable, `${label} writable`),
    writeOwner: nonBlankString(result.writeOwner, `${label} writeOwner`),
    config: asJsonObject(redactAppServerSecrets(result.config, `${label} config`)),
  }
}

export function parseAppServerHookList(value: unknown, label: string): AppServerHookList {
  const result = objectValue(value, label)
  const hooksValue = objectValue(result.hooks, `${label} hooks`)
  const hooks: { [eventName: string]: readonly AppServerHookHandler[] } = {}
  for (const [eventName, handlers] of Object.entries(hooksValue)) {
    nonBlankString(eventName, `${label} hooks event`)
    hooks[eventName] = arrayValue(handlers, `${label} hooks.${eventName}`).map((entry, index) => {
      const handler = objectValue(entry, `${label} hooks.${eventName}[${index}]`)
      return {
        command: nonBlankString(handler.command, `${label} hooks.${eventName}[${index}].command`),
        matcher: nullableString(handler.matcher, `${label} hooks.${eventName}[${index}].matcher`),
      }
    })
  }
  return {
    cwd: nonBlankString(result.cwd, `${label} cwd`),
    hooks,
  }
}

export function parseAppServerPluginList(value: unknown, label: string): AppServerPluginList {
  const result = objectValue(value, label)
  return {
    installed: pluginMap(result.installed, `${label} installed`),
    marketplaces: pluginMap(result.marketplaces, `${label} marketplaces`),
  }
}

export function parseAppServerPermissionProfiles(
  value: unknown,
  label: string,
): readonly AppServerPermissionProfile[] {
  const result = objectValue(value, label)
  return arrayValue(result.profiles, `${label} profiles`).map((entry, index) => {
    const profile = objectValue(entry, `${label} profiles[${index}]`)
    return {
      id: exactNonBlankString(profile.id, `${label} profiles[${index}].id`),
      name: nonBlankString(profile.name, `${label} profiles[${index}].name`),
      description: stringValue(profile.description, `${label} profiles[${index}].description`),
      settableAtRuntime: booleanValue(profile.settableAtRuntime, `${label} profiles[${index}].settableAtRuntime`),
    }
  })
}

export function parseAppServerCoreSpaceSnapshot(value: unknown, label: string): AppServerCoreSpaceSnapshot {
  const result = objectValue(value, label)
  const spaces = arrayValue(result.spaces, `${label} spaces`).map((entry, index) =>
    coreSpace(entry, `${label} spaces[${index}]`),
  )
  const keys = new Set(spaces.map((space) => space.projectKey))
  if (keys.size !== spaces.length) throw new Error(`CodeM ${label} contains duplicate spaces`)
  const current = result.current === null || result.current === undefined ? null : coreSpace(result.current, `${label} current`)
  if (current && !keys.has(current.projectKey)) throw new Error(`CodeM ${label} current space is absent from its list`)
  return { current, spaces }
}

export function parseAppServerModelProviderCapabilities(
  value: unknown,
  label: string,
): AppServerModelProviderCapabilities {
  const result = objectValue(value, label)
  return {
    version: nonBlankString(result.version, `${label} version`),
    askUser: booleanMap(result.ask_user, `${label} ask_user`),
    custom: booleanMap(result.custom, `${label} custom`),
  }
}

export function parseAppServerToolList(value: unknown, expectedThreadId: string, label: string): AppServerToolList {
  const result = objectValue(value, label)
  const threadId = nonBlankString(result.threadId, `${label} threadId`)
  if (threadId !== expectedThreadId) throw new Error(`CodeM ${label} returned ${threadId}, expected ${expectedThreadId}`)
  const tools = arrayValue(result.tools, `${label} tools`)
  if (!tools.every((tool) => typeof tool === "string" && tool.trim() && tool === tool.trim())) {
    throw new Error(`CodeM ${label} tools must be exact non-empty strings`)
  }
  return {
    threadId,
    model: nonBlankString(result.model, `${label} model`),
    tools: tools as readonly string[],
  }
}

export function parseAppServerLoadedThreads(value: unknown, label: string): AppServerLoadedThreads {
  const result = objectValue(value, label)
  const threadIds = arrayValue(result.threadIds, `${label} threadIds`)
  if (!threadIds.every((id) => typeof id === "string" && id.trim() && id === id.trim())) {
    throw new Error(`CodeM ${label} threadIds must be exact non-empty strings`)
  }
  return { threadIds: threadIds as readonly string[] }
}

export function parseAppServerBackgroundTerminalList(
  value: unknown,
  label: string,
): AppServerBackgroundTerminalList {
  const result = objectValue(value, label)
  return {
    cwd: nonBlankString(result.cwd, `${label} cwd`),
    terminals: arrayValue(result.terminals, `${label} terminals`).map((entry, index) =>
      backgroundTerminal(entry, `${label} terminals[${index}]`),
    ),
  }
}

export function parseAppServerBackgroundTerminalClean(
  value: unknown,
  label: string,
): AppServerBackgroundTerminalClean {
  const result = objectValue(value, label)
  return {
    cwd: nonBlankString(result.cwd, `${label} cwd`),
    results: arrayValue(result.results, `${label} results`).map((entry, index) => ({
      processId: processIdValue(objectValue(entry, `${label} results[${index}]`).processId, `${label} results[${index}].processId`),
    })),
  }
}

function liveSnapshotCursor(value: unknown, label: string): number | null {
  if (value === null) return null
  const cursor = nonNegativeInteger(value, label)
  if (!Number.isSafeInteger(cursor)) throw new Error(`CodeM ${label} must be a safe integer`)
  return cursor
}

export function parseAppServerLiveTurns(value: unknown, label: string): AppServerLivePage<AppServerLiveTurn> {
  const result = objectValue(value, label)
  return {
    entries: arrayValue(result.turns, `${label} turns`).map((entry, index) => {
      const turn = objectValue(entry, `${label} turns[${index}]`)
      return {
        id: exactNonBlankString(turn.id, `${label} turns[${index}].id`),
        status: nullableString(turn.status, `${label} turns[${index}].status`),
        startedAt: nullableString(turn.startedAt, `${label} turns[${index}].startedAt`),
      }
    }),
    nextCursor: liveSnapshotCursor(result.nextCursor, `${label} nextCursor`),
    total: nonNegativeInteger(result.total, `${label} total`),
  }
}

export function parseAppServerLiveItems(value: unknown, label: string): AppServerLivePage<AppServerLiveItem> {
  const result = objectValue(value, label)
  return {
    entries: arrayValue(result.items, `${label} items`).map((entry, index): AppServerLiveItem => {
      const itemLabel = `${label} items[${index}]`
      const item = objectValue(entry, itemLabel)
      if (item.type !== "steerAccepted") return parseAppServerItem(item, itemLabel)
      if (item.status !== "completed") throw new Error(`Invalid ${itemLabel} steerAccepted status`)
      return { id: exactNonBlankString(item.id, `${itemLabel}.id`), type: "steerAccepted", status: "completed", mode: exactNonBlankString(item.mode, `${itemLabel}.mode`), recordSeq: nonNegativeInteger(item.recordSeq, `${itemLabel}.recordSeq`), text: stringValue(item.text, `${itemLabel}.text`) }
    }),
    nextCursor: liveSnapshotCursor(result.nextCursor, `${label} nextCursor`),
    total: nonNegativeInteger(result.total, `${label} total`),
  }
}

export function threadModelSelection(model: string, intelligence: string): AppServerThreadModelSelection {
  return {
    id: exactNonBlankString(model, "thread model"),
    intelligence: exactNonBlankString(intelligence, "thread intelligence"),
  }
}

export function redactAppServerSecrets(value: unknown, label: string): AppServerJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`CodeM ${label} must be finite`)
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactAppServerSecrets(entry, `${label}[${index}]`))
  }
  const object = objectValue(value, label)
  const redacted: { [key: string]: AppServerJsonValue } = {}
  for (const [key, entry] of Object.entries(object)) {
    redacted[key] = isSecretConfigKey(key) ? null : redactAppServerSecrets(entry, `${label}.${key}`)
  }
  return redacted
}

function isSecretConfigKey(key: string): boolean {
  return SECRET_CONFIG_KEYS.has(key.toLowerCase())
}

function pluginMap(
  value: unknown,
  label: string,
): { readonly [name: string]: { readonly [key: string]: AppServerJsonValue } } {
  const object = objectValue(value, label)
  const mapped: { [name: string]: { readonly [key: string]: AppServerJsonValue } } = {}
  for (const [name, entry] of Object.entries(object)) {
    mapped[exactNonBlankString(name, `${label} name`)] = objectAfterRedaction(
      redactAppServerSecrets(entry, `${label}.${name}`),
      `${label}.${name}`,
    )
  }
  return mapped
}

function booleanMap(value: unknown, label: string): { readonly [capability: string]: boolean } {
  const object = objectValue(value, label)
  const mapped: { [capability: string]: boolean } = {}
  for (const [key, entry] of Object.entries(object)) {
    mapped[exactNonBlankString(key, `${label} key`)] = booleanValue(entry, `${label}.${key}`)
  }
  return mapped
}

function coreSpace(value: unknown, label: string): AppServerCoreSpace {
  const space = objectValue(value, label)
  return {
    projectKey: exactNonBlankString(
      space.projectKey ?? space.project_key,
      `${label} projectKey`,
    ),
    displayName: nonBlankString(space.displayName ?? space.display_name ?? space.name, `${label} displayName`),
  }
}

function backgroundTerminal(value: unknown, label: string): AppServerBackgroundTerminal {
  const terminal = objectValue(value, label)
  return {
    processId: processIdValue(terminal.processId, `${label}.processId`),
    logPath: nonBlankString(terminal.logPath, `${label}.logPath`),
    // Core 0.8.37 reports process liveness as alive; inProgress is our host DTO.
    inProgress: booleanValue(terminal.alive, `${label}.alive`),
  }
}

export function processIdValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`CodeM ${label} must be a positive integer`)
  }
  return value
}

function asJsonObject(value: AppServerJsonValue): { readonly [key: string]: AppServerJsonValue } {
  return objectAfterRedaction(value, "config")
}

function objectAfterRedaction(
  value: AppServerJsonValue,
  label: string,
): { readonly [key: string]: AppServerJsonValue } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`CodeM ${label} must be a JSON object after secret redaction`)
  }
  return value as { readonly [key: string]: AppServerJsonValue }
}

function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`CodeM ${label} must be an object`)
  }
  return value as JsonObject
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`CodeM ${label} must be an array`)
  return value
}

function nonBlankString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`CodeM ${label} must be non-empty`)
  return value
}

function exactNonBlankString(value: unknown, label: string): string {
  const text = nonBlankString(value, label)
  if (text !== text.trim()) throw new Error(`CodeM ${label} must not contain surrounding whitespace`)
  return text
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`CodeM ${label} must be a string`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  return stringValue(value, label)
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`CodeM ${label} must be a boolean`)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`CodeM ${label} must be a non-negative integer`)
  }
  return value
}
