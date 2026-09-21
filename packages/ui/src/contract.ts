/**
 * Cycle 3：双宿主正式聊天壳。
 *
 * 边界：对话区只读 Host 快照 messages + assistantText + 思考/工具字段；终态只认 turn/completed；
 * 持久历史只读 schema 13 后投影进同一 messages。不建 transcript 存储，不用 live turns/items 填对话区。
 * 账户状态由 Host 写入 snapshot.account，动作只有 signIn/signOut/cancelSignIn/refreshAccount。
 * 斜杠目录可来自 snapshot.slashCommands，缺省用方案固定命令；打开菜单不打 Core。
 * 状态所有者：Host 拥有快照、账户、目录；UI 只持有草稿、菜单开合、账户页/斜杠展开、分组折叠。
 * 清理：卸载随 React root；忙碌或 workspace/space/thread 切换关闭菜单与斜杠；账户退出关闭资料页。
 * 必须保持：首屏 hiddenUntilReady；空态无分页/重试/恢复；不把原始帧/路径/密钥画进 DOM。
 */
import {
  parseCodemIntelligence,
  parseCodemPermissionMode,
  type CodemBuiltinIntelligence,
  type CodemPermissionMode,
} from "@codem/protocol"

export type ChatPhase =
  | "disconnected"
  | "connecting"
  | "ready"
  | "sending"
  | "running"
  | "stopping"
  | "failed"
  | "closing"

export type ChatTheme = "light" | "dark"
export type WorkMode = "default" | "plan"
export type CatalogKind =
  | "skills"
  | "environment"
  | "config"
  | "hooks"
  | "plugins"
  | "permissions"
  | "spaces"
  | "provider"
  | "live"
  | "tools"
export type ThreadOperation = "rename" | "fork" | "archive" | "unarchive" | "delete"
export type PanelKind = "approval" | "question" | "plan" | "rewind"

export interface ComposerChoice {
  id: string
  label: string
  description: string
  selected: boolean
}
export interface CatalogRow {
  label: string
  detail: string
}
export interface UsageView {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheWrite: number | null
}
export interface PlanItem {
  content: string
  status: string
}
export interface DiffView {
  id: string
  label: string
  added: number
  removed: number
  preview: "complete" | "partial" | "binary" | "missing"
  available: boolean
}
export interface AttachmentView {
  id: string
  label: string
  kind: "file" | "directory" | "image"
}
export interface SelectionView {
  id: string
  label: string
}
export interface BackgroundView {
  id: string
  label: string
  inProgress: boolean
}
export interface SkillView {
  id: string
  name: string
  description: string
}
export interface PanelChoice {
  id: string
  label: string
}
export interface PendingPanel {
  id: string
  kind: PanelKind
  title: string
  description: string
  choices: readonly PanelChoice[]
  allowText: boolean
  multiple: boolean
}
export type ActivityStatus = "running" | "completed" | "failed" | "declined" | "interrupted" | "incomplete"
export type ChatMessageRole = "user" | "assistant" | "reasoning" | "tool"
export type AccountStatus = "checking" | "signedOut" | "signingIn" | "signedIn" | "error" | "signingOut" | "signOutFailed"
export type SignInProgress = "opening" | "waiting" | "binding" | "cancelling"
export type ComposerInputMode = "message" | "askSideQuestion" | "steer" | "shellCommand"

/** Host 投影：只含白名单字段，不含原始工具参数或绝对路径。 */
export interface ToolDetails {
  kind: string
  fields: readonly { label: string; value: string }[]
  code: string | null
}

export interface ChatMessage {
  id: string
  role: ChatMessageRole
  text: string
  turnId?: string
  label?: string
  status?: ActivityStatus
  summary?: string
  details?: ToolDetails
  /** 仅用于工作分组：是否有产物，不携带路径。 */
  hasArtifacts?: boolean
}

export interface TurnTiming {
  turnId: string
  startedAt: number
  finishedAt: number | null
}

export type AccountAvatar = { kind: "none" } | { kind: "unavailable" } | { kind: "image"; url: string }

export interface AccountProfile {
  avatar: AccountAvatar
  displayName: string | null
  userId: string | null
  tenantId: string | null
  authMethod: string | null
}

export type AccountState =
  | { status: "checking" }
  | { status: "signingOut" }
  | { status: "signOutFailed"; message: string }
  | { status: "signedOut"; notice: string | null }
  | { status: "signingIn"; progress: SignInProgress }
  | { status: "signedIn"; profile: AccountProfile; refreshing: boolean; notice: string | null }
  | { status: "error"; message: string }

export interface SlashCommand {
  id: string
  label: string
  group: string
}

export interface ChatSnapshot {
  type: "state"
  phase: ChatPhase
  workspace: string | null
  space: string | null
  threadId: string | null
  resumeThreadId: string | null
  model: string | null
  effort: CodemBuiltinIntelligence
  permission: CodemPermissionMode
  workMode: WorkMode
  modeRevision: number | null
  notice: string | null
  version: number
  theme: ChatTheme
  assistantText: string
  messages: readonly ChatMessage[]
  turnTimings: readonly TurnTiming[]
  account: AccountState
  accountOpen: boolean
  brandMark: string | null
  slashCommands: readonly SlashCommand[]
  pendingInteraction: string | null
  pendingPanel: PendingPanel | null
  canRetry: boolean
  canResume: boolean
  canLoadOlder: boolean
  hasOlderMessages: boolean
  historyNeedsRefresh: boolean
  composerCatalog: { models: readonly ComposerChoice[]; spaces: readonly ComposerChoice[] }
  capabilities: {
    plan: readonly PlanItem[]
    usage: UsageView | null
    activity: string | null
    changes: readonly { label: string; added: number; removed: number }[]
    threadStatus: string | null
  }
  sessionTools: {
    skills: readonly SkillView[]
    selectedSkill: string | null
    catalog: { kind: CatalogKind; rows: readonly CatalogRow[]; loaded: boolean } | null
    directories: readonly { id: string; label: string }[]
    busy: string | null
  }
  attachments: readonly AttachmentView[]
  selections: readonly SelectionView[]
  diffs: readonly DiffView[]
  background: readonly BackgroundView[]
}

export const catalogKinds: readonly CatalogKind[] = [
  "skills",
  "environment",
  "config",
  "hooks",
  "plugins",
  "permissions",
  "spaces",
  "provider",
  "live",
  "tools",
]

export const workModes: readonly { value: WorkMode; label: string; description: string }[] = [
  { value: "default", label: "Agent", description: "执行任务" },
  { value: "plan", label: "Plan", description: "先制定计划" },
]

export const permissions: readonly { value: CodemPermissionMode; label: string; description: string }[] = [
  { value: "default", label: "默认权限", description: "遵循 Core 默认审批策略" },
  { value: "auto", label: "自动审批", description: "由 Core 自动评估工具权限" },
  { value: "yolo", label: "完全访问", description: "跳过工具权限审批" },
]

export const efforts: readonly { value: CodemBuiltinIntelligence; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "最高" },
]

export const themes: readonly { value: ChatTheme; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
]

export function hiddenUntilReady(): readonly ["olderMessages", "retryConnect", "resumeThread"] {
  return ["olderMessages", "retryConnect", "resumeThread"]
}

/** A08：条件成立才显示，不再写死 resume/older = false。Host 未响应不出重试。 */
export function visibleControls(snapshot: Pick<ChatSnapshot, "phase" | "canRetry" | "canResume" | "canLoadOlder">): {
  retry: boolean
  resume: boolean
  older: boolean
} {
  return {
    retry: snapshot.phase === "failed" && snapshot.canRetry === true,
    resume: snapshot.canResume === true,
    older: snapshot.canLoadOlder === true,
  }
}

export function initialSnapshot(): ChatSnapshot {
  return {
    type: "state",
    phase: "disconnected",
    workspace: null,
    space: null,
    threadId: null,
    resumeThreadId: null,
    model: null,
    effort: "medium",
    permission: "default",
    workMode: "default",
    modeRevision: null,
    notice: null,
    version: 0,
    theme: "light",
    assistantText: "",
    messages: [],
    turnTimings: [],
    account: { status: "checking" },
    accountOpen: false,
    brandMark: null,
    slashCommands: [],
    pendingInteraction: null,
    pendingPanel: null,
    canRetry: false,
    canResume: false,
    canLoadOlder: false,
    hasOlderMessages: false,
    historyNeedsRefresh: false,
    composerCatalog: { models: [], spaces: [] },
    capabilities: { plan: [], usage: null, activity: null, changes: [], threadStatus: null },
    sessionTools: { skills: [], selectedSkill: null, catalog: null, directories: [], busy: null },
    attachments: [],
    selections: [],
    diffs: [],
    background: [],
  }
}

const chatPhases: readonly ChatPhase[] = ["disconnected", "connecting", "ready", "sending", "running", "stopping", "failed", "closing"]

/** VS Code 现网 phase 收成共享 phase，避免生产替换后旧快照无法驱动控件。 */
export function normalizePhase(value: unknown): ChatPhase {
  if (value === "sideQuestion") return "ready"
  if (value === "loadingHistory" || value === "configuring") return "connecting"
  if (typeof value === "string" && chatPhases.some((phase) => phase === value)) return value as ChatPhase
  return "disconnected"
}

export function isBusy(phase: ChatPhase): boolean {
  return phase === "connecting" || phase === "sending" || phase === "running" || phase === "stopping"
}

export function parseWorkMode(value: unknown): WorkMode {
  if (value !== "default" && value !== "plan") throw new Error("Invalid CodeM action")
  return value
}

export function parseTheme(value: unknown): ChatTheme {
  if (value !== "light" && value !== "dark") throw new Error("Invalid CodeM action")
  return value
}

const simpleActions = [
  "ready",
  "connect",
  "signIn",
  "signOut",
  "cancelSignIn",
  "newChat",
  "stop",
  "refreshAccount",
  "showHistory",
  "refreshSpaces",
  "olderMessages",
  "refreshBackground",
  "cleanBackground",
  "addDirectory",
  "cancelSideQuestion",
  "pinSelection",
] as const

const handleActions = [
  "chooseModel",
  "chooseSpace",
  "openDiff",
  "terminateBackground",
  "cancelBackgroundTask",
  "removeAttachment",
  "removeDirectory",
] as const

const requestIdPattern = /^[a-zA-Z0-9-]{1,100}$/u
const threadIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const handlePattern = /^[a-zA-Z0-9-]{1,100}$/u

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid CodeM action")
  return value as Record<string, unknown>
}

function requestId(value: unknown): string {
  if (typeof value !== "string" || !requestIdPattern.test(value)) throw new Error("Invalid CodeM action")
  return value
}

function threadId(value: unknown): string {
  if (typeof value !== "string" || !threadIdPattern.test(value)) throw new Error("Invalid CodeM action")
  return value
}

function handleId(value: unknown): string {
  if (typeof value !== "string" || !handlePattern.test(value)) throw new Error("Invalid CodeM action")
  return value
}

function nonEmptyText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 32_000) throw new Error("Invalid CodeM action")
  return value
}

function optionalIds(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new Error("Invalid CodeM action")
  if (new Set(value).size !== value.length || !value.every((id) => typeof id === "string" && handlePattern.test(id))) {
    throw new Error("Invalid CodeM action")
  }
  return value as string[]
}

/** 与 contracts/webview 及 Kotlin ViewActions 共用的动作校验。 */
export function parseUiAction(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  const keys = Object.keys(record)
  if (record.type === "send") {
    const selectionIds = optionalIds(record.selectionIds)
    const attachmentIds = optionalIds(record.attachmentIds)
    const skillName = record.skillName === undefined ? undefined : handleId(record.skillName)
    if (skillName !== undefined && attachmentIds?.length) throw new Error("Invalid CodeM action")
    const expected = 3 + (selectionIds ? 1 : 0) + (attachmentIds ? 1 : 0) + (skillName ? 1 : 0)
    if (keys.length !== expected) throw new Error("Invalid CodeM action")
    return {
      type: "send",
      text: nonEmptyText(record.text),
      requestId: requestId(record.requestId),
      ...(selectionIds ? { selectionIds } : {}),
      ...(attachmentIds ? { attachmentIds } : {}),
      ...(skillName ? { skillName } : {}),
    }
  }
  if (record.type === "panelReply") {
    if (keys.length !== 5) throw new Error("Invalid CodeM action")
    const id = requestId(record.id)
    if (!Array.isArray(record.choiceIds) || typeof record.text !== "string" || typeof record.cancelled !== "boolean") {
      throw new Error("Invalid CodeM action")
    }
    if (record.choiceIds.length > 100 || !record.choiceIds.every((item) => typeof item === "string" && handlePattern.test(item))) {
      throw new Error("Invalid CodeM action")
    }
    if (new Set(record.choiceIds).size !== record.choiceIds.length) throw new Error("Invalid CodeM action")
    if (record.text.length > 16_000) throw new Error("Invalid CodeM action")
    if (record.cancelled && (record.choiceIds.length > 0 || record.text !== "")) throw new Error("Invalid CodeM action")
    return { type: "panelReply", id, choiceIds: record.choiceIds, text: record.text, cancelled: record.cancelled }
  }
  if (record.type === "resumeThread" && keys.length === 2) return { type: "resumeThread", threadId: threadId(record.threadId) }
  if (record.type === "setEffort" && keys.length === 2) return { type: "setEffort", effort: parseCodemIntelligence(record.effort) }
  if (record.type === "setWorkMode" && keys.length === 2) return { type: "setWorkMode", workMode: parseWorkMode(record.workMode) }
  if (record.type === "setPermission" && keys.length === 2) {
    return { type: "setPermission", permission: parseCodemPermissionMode(record.permission) }
  }
  if (record.type === "setTheme" && keys.length === 2) return { type: "setTheme", theme: parseTheme(record.theme) }
  if (record.type === "pickAttachment" && keys.length === 2 && (record.kind === "file" || record.kind === "directory")) {
    return { type: "pickAttachment", kind: record.kind }
  }
  if (record.type === "selectSkill" && keys.length === 2 && (record.id === null || (typeof record.id === "string" && threadIdPattern.test(record.id)))) {
    return { type: "selectSkill", id: record.id }
  }
  if (record.type === "loadCatalog" && keys.length === 2 && catalogKinds.some((kind) => kind === record.kind)) {
    return { type: "loadCatalog", kind: record.kind }
  }
  if (record.type === "loadMoreLiveSnapshot" && keys.length === 3 && (record.kind === "turns" || record.kind === "items")) {
    return { type: "loadMoreLiveSnapshot", snapshotId: threadId(record.snapshotId), kind: record.kind }
  }
  if (record.type === "cancelLiveSnapshot" && keys.length === 2) {
    return { type: "cancelLiveSnapshot", snapshotId: threadId(record.snapshotId) }
  }
  if (record.type === "manageThread" && keys.length === 5) {
    const operation = record.operation
    if (!["rename", "fork", "archive", "unarchive", "delete"].includes(String(operation))) throw new Error("Invalid CodeM action")
    if (typeof record.name !== "string" || record.name.length > 160) throw new Error("Invalid CodeM action")
    if (operation === "rename" ? !record.name.trim() : record.name !== "") throw new Error("Invalid CodeM action")
    return {
      type: "manageThread",
      operation,
      threadId: threadId(record.threadId),
      name: record.name,
      requestId: requestId(record.requestId),
    }
  }
  if (["steer", "askSideQuestion", "shellCommand"].includes(String(record.type)) && keys.length === 4) {
    return {
      type: record.type,
      threadId: threadId(record.threadId),
      text: nonEmptyText(record.text),
      requestId: requestId(record.requestId),
    }
  }
  if (["compactThread", "rewindThread", "clearThread"].includes(String(record.type)) && keys.length === 3) {
    return { type: record.type, threadId: threadId(record.threadId), requestId: requestId(record.requestId) }
  }
  if (keys.length === 1 && simpleActions.some((type) => type === record.type)) return { type: record.type }
  if (keys.length === 2 && handleActions.some((type) => type === record.type)) {
    return { type: record.type, id: handleId(record.id) }
  }
  throw new Error("Unsupported CodeM action")
}

const activityStatuses: readonly ActivityStatus[] = ["running", "completed", "failed", "declined", "interrupted", "incomplete"]

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 8_000 ? value : undefined
}

function asToolDetails(value: unknown): ToolDetails | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as { kind?: unknown; fields?: unknown; code?: unknown }
  if (typeof record.kind !== "string" || record.kind.length > 64) return undefined
  if (!Array.isArray(record.fields) || record.fields.length > 50) return undefined
  const fields = record.fields.flatMap((field) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return []
    const row = field as { label?: unknown; value?: unknown }
    if (typeof row.label !== "string" || typeof row.value !== "string") return []
    if (!row.value.trim()) return []
    return [{ label: row.label.slice(0, 80), value: row.value.slice(0, 800) }]
  })
  return { kind: record.kind, fields, code: typeof record.code === "string" ? record.code.slice(0, 4000) : null }
}

/** 把 Host 投影（含 VS Code 现网消息）收成共享消息，丢掉 turnStatus 与未知角色。 */
export function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  const messages: ChatMessage[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== "string" || !record.id || typeof record.text !== "string") continue
    const text = record.text.length > 64_000 ? record.text.slice(0, 64_000) : record.text
    const turnId = optionalText(record.turnId)
    const label = optionalText(record.label)
    const hasArtifacts = Array.isArray(record.artifacts) ? record.artifacts.length > 0 : record.hasArtifacts === true
    if (record.role === "user" || record.role === "assistant") {
      messages.push({ id: record.id, role: record.role, text, ...(turnId ? { turnId } : {}), ...(label ? { label } : {}), ...(hasArtifacts ? { hasArtifacts } : {}) })
      continue
    }
    if (record.role === "reasoning" || record.role === "tool") {
      const status = activityStatuses.find((item) => item === record.status) ?? "completed"
      const details = asToolDetails(record.details)
      messages.push({
        id: record.id,
        role: record.role,
        text,
        status,
        summary: typeof record.summary === "string" ? record.summary.slice(0, 4000) : "",
        ...(turnId ? { turnId } : {}),
        ...(label ? { label } : { label: record.role === "reasoning" ? "思考过程" : "工具" }),
        ...(details ? { details } : {}),
      })
    }
  }
  return messages
}

function normalizeAccount(value: unknown): AccountState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "checking" }
  const record = value as AccountState
  if (record.status === "checking" || record.status === "signingOut") return { status: record.status }
  if (record.status === "signOutFailed") return { status: "signOutFailed", message: typeof record.message === "string" ? record.message : "退出未完成" }
  if (record.status === "signedOut") return { status: "signedOut", notice: typeof record.notice === "string" ? record.notice : null }
  if (record.status === "signingIn") {
    const progress = record.progress
    return { status: "signingIn", progress: progress === "waiting" || progress === "binding" || progress === "cancelling" ? progress : "opening" }
  }
  if (record.status === "error") return { status: "error", message: typeof record.message === "string" ? record.message : "登录状态检查失败" }
  if (record.status === "signedIn" && record.profile && typeof record.profile === "object") {
    const profile = record.profile
    const avatar = profile.avatar
    return {
      status: "signedIn",
      refreshing: record.refreshing === true,
      notice: typeof record.notice === "string" ? record.notice : null,
      profile: {
        displayName: typeof profile.displayName === "string" ? profile.displayName : null,
        userId: typeof profile.userId === "string" ? profile.userId : null,
        tenantId: typeof profile.tenantId === "string" ? profile.tenantId : null,
        authMethod: typeof profile.authMethod === "string" ? profile.authMethod : null,
        avatar:
          avatar && typeof avatar === "object" && avatar.kind === "image" && typeof avatar.url === "string"
            ? { kind: "image", url: avatar.url }
            : avatar && typeof avatar === "object" && avatar.kind === "unavailable"
              ? { kind: "unavailable" }
              : { kind: "none" },
      },
    }
  }
  return { status: "checking" }
}

function normalizeSlashCommands(value: unknown): SlashCommand[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const record = item as SlashCommand
    if (typeof record.id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/u.test(record.id)) return []
    if (typeof record.label !== "string" || !record.label.trim() || record.label.length > 80) return []
    if (typeof record.group !== "string" || !record.group.trim() || record.group.length > 20) return []
    return [{ id: record.id, label: record.label, group: record.group }]
  })
}

function normalizeTimings(value: unknown): TurnTiming[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const record = item as TurnTiming
    if (typeof record.turnId !== "string" || !record.turnId) return []
    if (typeof record.startedAt !== "number" || !Number.isFinite(record.startedAt)) return []
    return [{ turnId: record.turnId, startedAt: record.startedAt, finishedAt: typeof record.finishedAt === "number" ? record.finishedAt : null }]
  })
}

export function asSnapshot(value: unknown): ChatSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Partial<ChatSnapshot> & { type?: unknown }
  if (record.type !== "state") return null
  const base = initialSnapshot()
  return {
    ...base,
    ...record,
    type: "state",
    phase: normalizePhase(record.phase),
    messages: normalizeMessages(record.messages ?? base.messages),
    turnTimings: normalizeTimings(record.turnTimings ?? base.turnTimings),
    account: normalizeAccount(record.account ?? base.account),
    accountOpen: record.accountOpen === true,
    brandMark: typeof record.brandMark === "string" ? record.brandMark : base.brandMark,
    slashCommands: normalizeSlashCommands(record.slashCommands ?? base.slashCommands),
    assistantText: typeof record.assistantText === "string" ? record.assistantText : "",
  }
}

export function isSignedIn(account: AccountState): account is Extract<AccountState, { status: "signedIn" }> {
  return account.status === "signedIn"
}

export function elapsedTime(timing: TurnTiming, now: number): string {
  const end = timing.finishedAt ?? now
  const seconds = Math.max(0, Math.floor((end - timing.startedAt) / 1000))
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`
}
