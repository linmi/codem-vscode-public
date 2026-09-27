import type { ConversationSearchView, PluginManagementView } from "@codem/protocol"
import { catalogKinds, type CatalogKind } from "@codem/protocol"
/**
 * Cycle 3：双宿主正式聊天壳。
 *
 * 边界：对话区只读 Host 快照 messages + assistantText + 思考/工具字段；终态只认 turn/completed；
 * 持久历史只读 schema 13 后投影进同一 messages。不建 transcript 存储，不用 live turns/items 填对话区。
 * 账户状态由 Host 写入 snapshot.account，动作只有 signIn/signOut/cancelSignIn/refreshAccount。
 * 斜杠目录可来自 snapshot.slashCommands，缺省用方案固定命令；打开菜单不打 Core。
 * 状态所有者：Host 拥有快照、账户、目录；UI 只持有草稿、菜单开合、账户页/斜杠展开、分组折叠。
 * Host 要打开账户页只递增 accountRequest，要打开权限菜单只递增 permissionMenuRequest，都不持有开合。
 * 清理：卸载随 React root；忙碌或 workspace/space/thread 切换关闭菜单与斜杠；账户退出关闭资料页。
 * 必须保持：重试/恢复/更早消息只由 visibleControls 决定，首屏按 initialSnapshot 隐藏；不把原始帧/路径/密钥画进 DOM。
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
  | "configuring"
  | "loadingHistory"
  | "sideQuestion"
  | "ready"
  | "sending"
  | "running"
  | "stopping"
  | "failed"
  | "closing"

export type ChatTheme = "light" | "dark"
export type WorkMode = "default" | "plan"
/** 会话管理操作的唯一清单：动作校验、斜杠命令路由和确认面板都从这里判断。 */
const threadOperations = ["rename", "fork", "archive", "unarchive", "delete"] as const
export type ThreadOperation = (typeof threadOperations)[number]

export function isThreadOperation(value: unknown): value is ThreadOperation {
  return threadOperations.some((operation) => operation === value)
}

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
export interface CatalogSnapshot {
  kind: CatalogKind
  rows: readonly CatalogRow[]
  loaded: boolean
  stale: boolean
  snapshotId?: string
  loading?: "refresh" | "turns" | "items" | null
  error?: string | null
  pages?: { turns: LiveSnapshotPageView; items: LiveSnapshotPageView } | null
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
export interface GuardView {
  id: string
  tool: string
  status: string
  returnedBytes: number
  rawBytes: number | null
  capped: boolean
}
export interface HookView {
  id: string
  event: string
  tool: string | null
  outcome: string
  elapsedMs: number
}
export interface LiveSnapshotPageView {
  rows: readonly CatalogRow[]
  total: number
  hasMore: boolean
}
export interface SideQuestionView {
  question: string
  answer: string
  status: SideQuestionStatus
}
export interface DiffView {
  id: string
  turnId?: string
  label: string
  added: number
  removed: number
  preview: "complete" | "partial" | "raw-partial" | "binary" | "omitted" | "missing"
  available: boolean
}
export type AttachmentPreview =
  | { kind: "deferred" }
  | { kind: "none" }
  | { kind: "image"; dataUrl: string }
  | { kind: "unavailable"; reason: string }
export interface AttachmentView {
  id: string
  label: string
  kind: "file" | "directory" | "image"
  preview?: AttachmentPreview
}
export interface ArtifactView {
  id: string
  kind: "file" | "image" | "chart" | "url" | "diff"
  title: string
  detail: string
  available: boolean
}
export interface BackgroundTaskView {
  id: string
  label: string
  phase: BackgroundTaskPhase
}
export interface SelectionView {
  id: string
  label: string
  startLine?: number | null
  endLine?: number | null
  pinned?: boolean
  error?: string | null
}

export interface HistoryEntry {
  id: string
  title: string
  archived: boolean
  startedAt?: string
  turnCount?: number
}

export interface HistoryList {
  open: boolean
  loading: boolean
  entries: readonly HistoryEntry[]
  hasMore: boolean
  error: string | null
}

export interface FileHit {
  id: string
  label: string
}

export interface FileSearch {
  requestId: string
  status: "loading" | "empty" | "ready" | "error"
  files: readonly FileHit[]
  error: string | null
}

export type SendKey = "enter" | "modEnter"
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
  description?: string
  selected?: boolean
  icon?: PermissionChoiceIcon
}
export interface PendingPanel {
  id: string
  kind: PanelKind
  title: string
  description: string
  detail: string | null
  choices: readonly PanelChoice[]
  allowText: boolean
  multiple: boolean
  backChoiceId: string | null
  initialText: string
  confirmLabel: string | null
}

/** 运行中排队的一条消息；本轮完成后按顺序作为新一轮发送。 */
export interface QueuedMessageView {
  id: string
  text: string
}

/** 宿主持有的排队消息。paused：上一轮停止或失败，不自动发送，等用户继续。 */
export interface MessageQueueView {
  items: readonly QueuedMessageView[]
  paused: boolean
}

/** VS Code 用发送回执确认；JetBrains 用与 requestId 相同的用户消息 id。两者都算受理。 */
export interface SubmissionReceipt {
  requestId: string
  accepted: boolean
}
export type ActivityStatus = "running" | "completed" | "failed" | "declined" | "interrupted" | "incomplete"
export type ChatMessageRole = "user" | "assistant" | "reasoning" | "tool" | "turnStatus"
export type PermissionChoiceIcon = "hand" | "shieldCheck" | "shieldAlert"
export type BackgroundTaskPhase = "queued" | "started" | "skipped" | "cancelled" | "notFound" | "noop"
export type SideQuestionStatus = "starting" | "running" | "stopping" | "completed" | "interrupted" | "failed" | "incomplete"
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
  outcome?: "stopped"
  artifacts?: readonly ArtifactView[]
  attachments?: readonly AttachmentView[]
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
  pluginManagement: PluginManagementView | null
  conversationSearch: ConversationSearchView | null
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
  /** Host 请求打开账户页的序号，每次请求递增。账户页开合只归界面，返回不经过 Host。 */
  accountRequest: number
  /** Host 请求打开权限菜单的序号，每次请求递增。菜单开合只归界面；忙碌时界面忽略这次请求。 */
  permissionMenuRequest: number
  brandMark: string | null
  slashCommands: readonly SlashCommand[]
  pendingInteraction: string | null
  pendingPanel: PendingPanel | null
  submission: SubmissionReceipt | null
  /** 宿主不支持排队时为 null，运行中输入仍作为补充指令。 */
  messageQueue: MessageQueueView | null
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
    guards: readonly GuardView[]
    hooks: readonly HookView[]
    threadStatus: string | null
  }
  sessionTools: {
    skills: readonly SkillView[]
    selectedSkill: string | null
    catalog: CatalogSnapshot | null
    directories: readonly { id: string; label: string }[]
    busy: string | null
    sideQuestion: SideQuestionView | null
  }
  attachments: readonly AttachmentView[]
  selections: readonly SelectionView[]
  diffs: readonly DiffView[]
  background: readonly BackgroundView[]
  backgroundTasks: readonly BackgroundTaskView[]
  backgroundBusy: boolean
  tools: readonly string[]
  mcpNames: readonly string[]
  history: HistoryList
  fileSearch: FileSearch | null
  sendKey: SendKey
}


export const workModes: readonly { value: WorkMode; label: string; description: string }[] = [
  { value: "default", label: "Agent", description: "执行任务" },
  { value: "plan", label: "Plan", description: "先制定计划" },
]

export const permissions: readonly { value: CodemPermissionMode; label: string; description: string }[] = [
  { value: "default", label: "默认权限", description: "遵循 Core 默认审批策略" },
  { value: "auto", label: "自动审批", description: "由 Core 自动评估工具权限" },
  { value: "yolo", label: "完全访问", description: "跳过工具权限审批" },
]

/**
 * A08：重试、恢复上次会话、加载更早消息三个条件入口只看这里。
 * 首屏与 Host 未响应时三项都为 false；Host 残留的旗标也不会让入口出现在不该出现的状态里。
 */
export function visibleControls(
  snapshot: Pick<ChatSnapshot, "phase" | "threadId" | "resumeThreadId" | "canRetry" | "canResume" | "canLoadOlder">,
): { retry: boolean; resume: boolean; older: boolean } {
  return {
    retry: snapshot.canRetry && (snapshot.phase === "failed" || snapshot.phase === "disconnected"),
    resume: snapshot.canResume && snapshot.resumeThreadId !== null && snapshot.threadId === null,
    older: snapshot.canLoadOlder && snapshot.threadId !== null,
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
    accountRequest: 0,
    permissionMenuRequest: 0,
    brandMark: null,
    slashCommands: [],
    pendingInteraction: null,
    pendingPanel: null,
    submission: null,
    messageQueue: null,
    canRetry: false,
    canResume: false,
    canLoadOlder: false,
    pluginManagement: null,
    conversationSearch: null,
    hasOlderMessages: false,
    historyNeedsRefresh: false,
    composerCatalog: { models: [], spaces: [] },
    capabilities: { plan: [], usage: null, activity: null, changes: [], guards: [], hooks: [], threadStatus: null },
    sessionTools: { skills: [], selectedSkill: null, catalog: null, directories: [], busy: null, sideQuestion: null },
    attachments: [],
    selections: [],
    diffs: [],
    background: [],
    backgroundTasks: [],
    backgroundBusy: false,
    tools: [],
    mcpNames: [],
    history: { open: false, loading: false, entries: [], hasMore: false, error: null },
    fileSearch: null,
    sendKey: "enter",
  }
}

const chatPhases: readonly ChatPhase[] = [
  "disconnected", "connecting", "configuring", "loadingHistory", "sideQuestion",
  "ready", "sending", "running", "stopping", "failed", "closing",
]

/** 保留 VS Code 现网 phase。配置、读历史和旁路提问各自有界面，不并进连接中或就绪。 */
function normalizePhase(value: unknown): ChatPhase {
  if (typeof value === "string" && chatPhases.some((phase) => phase === value)) return value as ChatPhase
  return "disconnected"
}

export function isBusy(phase: ChatPhase): boolean {
  return phase !== "ready" && phase !== "disconnected" && phase !== "failed" && phase !== "closing"
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
  "showPluginManagement", "closePluginManagement", "cancelPluginOperation", "installLocalPlugin",
  "showConversationSearch", "closeConversationSearch",
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
  "closeHistory",
  "refreshHistory",
  "moreThreads",
  "reloadHistory",
  "showOutput",
  "manageMcp",
  "refreshTools",
  "resumeQueue",
] as const

const handleActions = [
  "selectConversationSearchHit",
  "chooseModel",
  "chooseSpace",
  "openDiff",
  "openArtifact",
  "openChangedFile",
  "openBackgroundLog",
  "loadImage",
  "terminateBackground",
  "cancelBackgroundTask",
  "removeAttachment",
  "removeDirectory",
  "removeSelection",
  "removeCodeSelection",
  "revealCodeSelection",
  "pinCodeSelection",
  "removeQueuedMessage",
] as const

const requestIdPattern = /^[a-zA-Z0-9-]{1,100}$/u
const threadIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const handlePattern = /^[a-zA-Z0-9-]{1,100}$/u
const pluginSpecPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

/** 插件市场安装标识 `插件名@市场名`。安装按钮是否可用与动作校验共用这一条规则。 */
export function isPluginSpec(value: unknown): value is string {
  return typeof value === "string" && pluginSpecPattern.test(value)
}

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
  if (record.type === "searchConversation" && keys.length === 2 && typeof record.query === "string" && record.query.trim() && record.query.length <= 512) return { type: "searchConversation", query: record.query }
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
  if (record.type === "installMarketplacePlugin" && keys.length === 2 && isPluginSpec(record.spec)) return { type: "installMarketplacePlugin", spec: record.spec }
  if (record.type === "changePlugin" && keys.length === 3 && ["enable", "disable", "uninstall"].includes(String(record.action))) return { type: "changePlugin", action: record.action, id: handleId(record.id) }
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
    if (!isThreadOperation(operation)) throw new Error("Invalid CodeM action")
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
  if (record.type === "editQueuedMessage" && keys.length === 3) {
    return { type: "editQueuedMessage", id: handleId(record.id), text: nonEmptyText(record.text) }
  }
  if (["steer", "askSideQuestion", "shellCommand", "queueMessage"].includes(String(record.type)) && keys.length === 4) {
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
  if (record.type === "searchFiles" && keys.length === 3) {
    if (typeof record.query !== "string" || record.query.length > 200 || [...record.query].some((character) => character.charCodeAt(0) < 32)) {
      throw new Error("Invalid CodeM action")
    }
    return { type: "searchFiles", query: record.query, requestId: requestId(record.requestId) }
  }
  if (record.type === "selectFile" && keys.length === 3) {
    return { type: "selectFile", id: handleId(record.id), requestId: requestId(record.requestId) }
  }
  if (record.type === "setSendKey" && keys.length === 2 && (record.sendKey === "enter" || record.sendKey === "modEnter")) {
    return { type: "setSendKey", sendKey: record.sendKey }
  }
  if (record.type === "dropAttachments" && keys.length === 2) return { type: "dropAttachments", uris: parseDroppedUris(record.uris) }
  if (record.type === "pasteImages" && keys.length === 3) {
    return { type: "pasteImages", requestId: requestId(record.requestId), images: parsePastedImages(record.images) }
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

/**
 * 深度冻结的 Host 消息与它的规范化结果。规范化只取决于消息本身，深度冻结的消息不会再变，
 * 所以同一个消息对象总能复用同一份冻结结果：没变的消息保持同一对象，消息列表据此跳过重渲染。
 * 范围：本模块（一个页面）；键为弱引用，消息对象被回收即失效。未冻结的输入（其他 Host 每次新解析的 JSON）每次重新规范化，结果不冻结。
 */
const frozenMessageViews = new WeakMap<object, ChatMessage | null>()

/** 把 Host 投影（含 VS Code 现网消息）收成共享消息，丢掉 turnStatus 与未知角色。 */
export function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  const messages: ChatMessage[] = []
  for (const item of value) {
    const view = messageView(item)
    if (view) messages.push(view)
  }
  return messages
}

function messageView(item: unknown): ChatMessage | null {
  if (!item || typeof item !== "object") return null
  const known = frozenMessageViews.get(item)
  if (known !== undefined) return known
  const view = normalizeMessage(item)
  if (!deeplyFrozen(item)) return view
  const shared = view && deepFreeze(view)
  frozenMessageViews.set(item, shared)
  return shared
}

function normalizeMessage(item: unknown): ChatMessage | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null
  const record = item as Record<string, unknown>
  if (typeof record.id !== "string" || !record.id || typeof record.text !== "string") return null
  const text = record.text.length > 64_000 ? record.text.slice(0, 64_000) : record.text
  const turnId = optionalText(record.turnId)
  const label = optionalText(record.label)
  const artifacts = normalizeArtifacts(record.artifacts)
  const attachments = record.role === "user" ? normalizeAttachments(record.attachments) : []
  const hasArtifacts = artifacts.length > 0 || record.hasArtifacts === true
  if (record.role === "turnStatus") {
    return { id: record.id, role: "turnStatus", text, outcome: "stopped", ...(turnId ? { turnId } : {}), ...(label ? { label } : {}) }
  }
  if (record.role === "user" || record.role === "assistant") {
    return {
      id: record.id,
      role: record.role,
      text,
      ...(turnId ? { turnId } : {}),
      ...(label ? { label } : {}),
      ...(artifacts.length ? { artifacts, hasArtifacts: true } : hasArtifacts ? { hasArtifacts: true } : {}),
      ...(attachments.length ? { attachments } : {}),
    }
  }
  if (record.role === "reasoning" || record.role === "tool") {
    const status = activityStatuses.find((item) => item === record.status) ?? "completed"
    const details = asToolDetails(record.details)
    return {
      id: record.id,
      role: record.role,
      text,
      status,
      summary: typeof record.summary === "string" ? record.summary.slice(0, 4000) : "",
      ...(turnId ? { turnId } : {}),
      ...(label ? { label } : { label: record.role === "reasoning" ? "思考过程" : "工具" }),
      ...(details ? { details } : {}),
    }
  }
  return null
}

function deeplyFrozen(value: unknown): boolean {
  if (!value || typeof value !== "object") return true
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
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

/** 拖入的只有 file: 地址；是否存在、是否在工作区内由 Host 再判断。 */
function parseDroppedUris(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error("Invalid CodeM action")
  for (const uri of value) {
    if (typeof uri !== "string" || uri.length > 4096 || !/^file:\/\//i.test(uri) || [...uri].some((character) => character.charCodeAt(0) < 32)) {
      throw new Error("Invalid CodeM action")
    }
  }
  return [...value]
}

const pasteTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

function parsePastedImages(value: unknown): { mediaType: string; data: string }[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error("Invalid CodeM action")
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid CodeM action")
    const image = item as { mediaType?: unknown; data?: unknown }
    if (typeof image.mediaType !== "string" || !pasteTypes.has(image.mediaType)) throw new Error("Invalid CodeM action")
    if (typeof image.data !== "string" || !image.data || image.data.length > 28_000_000) throw new Error("Invalid CodeM action")
    return { mediaType: image.mediaType, data: image.data }
  })
}

function normalizeHistory(value: unknown): HistoryList {
  const empty: HistoryList = { open: false, loading: false, entries: [], hasMore: false, error: null }
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty
  const record = value as Partial<HistoryList>
  const entries = Array.isArray(record.entries)
    ? record.entries.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const entry = item as HistoryEntry
        if (typeof entry.id !== "string" || !threadIdPattern.test(entry.id)) return []
        if (typeof entry.title !== "string" || !entry.title.trim()) return []
        const startedAt = typeof entry.startedAt === "string" && entry.startedAt.length <= 40 ? entry.startedAt : undefined
        const turnCount = typeof entry.turnCount === "number" && Number.isFinite(entry.turnCount) && entry.turnCount >= 0 ? entry.turnCount : undefined
        return [{ id: entry.id, title: entry.title.slice(0, 160), archived: entry.archived === true, ...(startedAt ? { startedAt } : {}), ...(turnCount !== undefined ? { turnCount } : {}) }]
      })
    : []
  return {
    open: record.open === true,
    loading: record.loading === true,
    entries,
    hasMore: record.hasMore === true,
    error: typeof record.error === "string" ? record.error : null,
  }
}

function normalizeFileSearch(value: unknown): FileSearch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Partial<FileSearch>
  if (typeof record.requestId !== "string" || !requestIdPattern.test(record.requestId)) return null
  if (record.status !== "loading" && record.status !== "empty" && record.status !== "ready" && record.status !== "error") return null
  const files = Array.isArray(record.files)
    ? record.files.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const file = item as FileHit
        if (typeof file.id !== "string" || !handlePattern.test(file.id)) return []
        if (typeof file.label !== "string" || !file.label.trim() || file.label.includes("..")) return []
        return [{ id: file.id, label: file.label.slice(0, 240) }]
      })
    : []
  return { requestId: record.requestId, status: record.status, files, error: typeof record.error === "string" ? record.error : null }
}

function normalizeSelections(value: unknown): SelectionView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const selection = item as SelectionView
    if (typeof selection.id !== "string" || !handlePattern.test(selection.id)) return []
    if (typeof selection.label !== "string" || !selection.label.trim()) return []
    const error = typeof selection.error === "string" && selection.error.trim() ? selection.error.slice(0, 160) : null
    return [{
      id: selection.id,
      label: selection.label.slice(0, 160),
      startLine: typeof selection.startLine === "number" ? selection.startLine : null,
      endLine: typeof selection.endLine === "number" ? selection.endLine : null,
      pinned: selection.pinned !== false,
      ...(error ? { error } : {}),
    }]
  })
}

const panelKinds: readonly PanelKind[] = ["approval", "question", "plan", "rewind"]

function safeLabel(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes("..")) return null
  const visible = trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed) ? trimmed.split(/[\\/]/).pop() ?? "" : trimmed
  return visible ? visible.slice(0, 160) : null
}

function normalizePanel(value: unknown): PendingPanel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Partial<PendingPanel>
  if (typeof record.id !== "string" || !requestIdPattern.test(record.id)) return null
  const kind = panelKinds.find((item) => item === record.kind)
  if (!kind) return null
  if (typeof record.title !== "string" || !record.title.trim()) return null
  const choices = Array.isArray(record.choices)
    ? record.choices.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const choice = item as PanelChoice
        if (typeof choice.id !== "string" || !handlePattern.test(choice.id)) return []
        if (typeof choice.label !== "string" || !choice.label.trim()) return []
        const description = typeof choice.description === "string" && choice.description.trim() ? choice.description.slice(0, 400) : undefined
        const icon = choice.icon === "hand" || choice.icon === "shieldCheck" || choice.icon === "shieldAlert" ? choice.icon : undefined
        return [{ id: choice.id, label: choice.label.slice(0, 160), ...(description ? { description } : {}), ...(choice.selected === true ? { selected: true } : {}), ...(icon ? { icon } : {}) }]
      })
    : []
  const back = typeof record.backChoiceId === "string" && handlePattern.test(record.backChoiceId) ? record.backChoiceId : null
  return {
    id: record.id,
    kind,
    title: record.title.slice(0, 160),
    description: typeof record.description === "string" ? record.description.slice(0, 4000) : "",
    detail: typeof record.detail === "string" ? record.detail.slice(0, 8000) : null,
    choices,
    allowText: record.allowText === true,
    multiple: record.multiple === true,
    backChoiceId: back,
    initialText: typeof record.initialText === "string" ? record.initialText.slice(0, 16_000) : "",
    confirmLabel: typeof record.confirmLabel === "string" && record.confirmLabel.trim() ? record.confirmLabel.slice(0, 80) : null,
  }
}

function normalizeDiffs(value: unknown): DiffView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const diff = item as DiffView
    if (typeof diff.id !== "string" || !handlePattern.test(diff.id)) return []
    if (typeof diff.label !== "string") return []
    const label = safeLabel(diff.label)
    if (!label) return []
    const rawPreview = (item as { preview?: unknown }).preview
    const preview = rawPreview === "complete" || rawPreview === "partial" || rawPreview === "raw-partial" || rawPreview === "binary" || rawPreview === "omitted" || rawPreview === "missing"
      ? rawPreview
      : null
    if (!preview) return []
    const turnId = typeof (item as { turnId?: unknown }).turnId === "string" ? safeId((item as { turnId: string }).turnId) : null
    return [{
      id: diff.id,
      ...(turnId ? { turnId } : {}),
      label,
      added: typeof diff.added === "number" && diff.added >= 0 ? diff.added : 0,
      removed: typeof diff.removed === "number" && diff.removed >= 0 ? diff.removed : 0,
      preview,
      available: diff.available !== false,
    }]
  })
}

function normalizeBackground(value: unknown): BackgroundView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as BackgroundView
    if (typeof row.id !== "string" || !handlePattern.test(row.id)) return []
    if (typeof row.label !== "string" || !row.label.trim()) return []
    return [{ id: row.id, label: row.label.slice(0, 160), inProgress: row.inProgress === true }]
  })
}

function normalizeAttachments(value: unknown): AttachmentView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as AttachmentView
    if (typeof row.id !== "string" || !handlePattern.test(row.id)) return []
    if (row.kind !== "file" && row.kind !== "directory" && row.kind !== "image") return []
    if (typeof row.label !== "string") return []
    const label = safeLabel(row.label)
    if (!label) return []
    const preview = attachmentPreview((row as { preview?: unknown }).preview)
    return [{ id: row.id, label, kind: row.kind, ...(preview ? { preview } : {}) }]
  })
}

function attachmentPreview(value: unknown): AttachmentPreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const preview = value as { kind?: unknown; dataUrl?: unknown; reason?: unknown }
  if (preview.kind === "deferred" || preview.kind === "none") return { kind: preview.kind }
  if (preview.kind === "unavailable") return { kind: "unavailable", reason: typeof preview.reason === "string" ? preview.reason.slice(0, 160) : "图片暂不可用" }
  if (preview.kind === "image" && typeof preview.dataUrl === "string" && preview.dataUrl.startsWith("data:image/") && preview.dataUrl.length <= 2_000_000) {
    return { kind: "image", dataUrl: preview.dataUrl }
  }
  return null
}

function normalizeArtifacts(value: unknown): ArtifactView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as ArtifactView
    if (typeof row.id !== "string" || !handlePattern.test(row.id)) return []
    if (row.kind !== "file" && row.kind !== "image" && row.kind !== "chart" && row.kind !== "url" && row.kind !== "diff") return []
    const title = displayText(row.title, 160)
    if (!title) return []
    return [{ id: row.id, kind: row.kind, title, detail: typeof row.detail === "string" ? row.detail.slice(0, 400) : "", available: row.available !== false }]
  })
}

function safeId(value: string): string | null {
  return value.length > 0 && value.length <= 128 && !value.includes("/") && !value.includes("\\") && !value.includes("..") ? value : null
}

function boundedText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : null
}

function displayText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  return safeLabel(value)?.slice(0, max) ?? null
}

function normalizeChoices(value: unknown): ComposerChoice[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const choice = item as ComposerChoice
    if (typeof choice.id !== "string" || !handlePattern.test(choice.id)) return []
    const label = displayText(choice.label, 160)
    if (!label) return []
    return [{
      id: choice.id,
      label,
      description: typeof choice.description === "string" ? choice.description.slice(0, 400) : "",
      selected: choice.selected === true,
    }]
  })
}

function normalizeCapabilities(value: unknown): ChatSnapshot["capabilities"] {
  const empty = initialSnapshot().capabilities
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty
  const record = value as ChatSnapshot["capabilities"]
  const plan = Array.isArray(record.plan)
    ? record.plan.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const row = item as PlanItem
        if (typeof row.content !== "string" || !row.content.trim()) return []
        return [{ content: row.content.slice(0, 400), status: typeof row.status === "string" ? row.status.slice(0, 40) : "" }]
      })
    : []
  const usage = record.usage && typeof record.usage === "object" ? record.usage : null
  const numberOrNull = (item: unknown) => (typeof item === "number" && Number.isFinite(item) ? item : null)
  const changes = Array.isArray(record.changes)
    ? record.changes.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const row = item as { label?: unknown; added?: unknown; removed?: unknown }
        const label = displayText(row.label, 160)
        if (!label) return []
        return [{
          label,
          added: typeof row.added === "number" && row.added >= 0 ? row.added : 0,
          removed: typeof row.removed === "number" && row.removed >= 0 ? row.removed : 0,
        }]
      })
    : []
  const guards = Array.isArray(record.guards)
    ? record.guards.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const row = item as GuardView
        if (typeof row.id !== "string" || !handlePattern.test(row.id)) return []
        if (typeof row.tool !== "string" || !row.tool.trim()) return []
        return [{
          id: row.id,
          tool: row.tool.slice(0, 80),
          status: typeof row.status === "string" ? row.status.slice(0, 40) : "",
          returnedBytes: typeof row.returnedBytes === "number" && row.returnedBytes >= 0 ? row.returnedBytes : 0,
          rawBytes: typeof row.rawBytes === "number" && row.rawBytes >= 0 ? row.rawBytes : null,
          capped: row.capped === true,
        }]
      })
    : []
  const hooks = Array.isArray(record.hooks)
    ? record.hooks.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const row = item as HookView
        if (typeof row.id !== "string" || !handlePattern.test(row.id)) return []
        if (typeof row.event !== "string" || !row.event.trim()) return []
        return [{
          id: row.id,
          event: row.event.slice(0, 80),
          tool: typeof row.tool === "string" ? row.tool.slice(0, 80) : null,
          outcome: typeof row.outcome === "string" ? row.outcome.slice(0, 40) : "",
          elapsedMs: typeof row.elapsedMs === "number" && row.elapsedMs >= 0 ? row.elapsedMs : 0,
        }]
      })
    : []
  return {
    plan,
    usage: usage ? { input: numberOrNull(usage.input), output: numberOrNull(usage.output), cacheRead: numberOrNull(usage.cacheRead), cacheWrite: numberOrNull(usage.cacheWrite) } : null,
    activity: boundedText(record.activity, 160),
    changes,
    guards,
    hooks,
    threadStatus: boundedText(record.threadStatus, 80),
  }
}

function normalizeSessionTools(value: unknown): ChatSnapshot["sessionTools"] {
  const empty = initialSnapshot().sessionTools
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty
  const record = value as ChatSnapshot["sessionTools"] & { catalog?: { kind?: unknown; rows?: unknown; loaded?: unknown } | null }
  const skills = Array.isArray(record.skills)
    ? record.skills.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const skill = item as SkillView
        if (typeof skill.id !== "string" || !handlePattern.test(skill.id)) return []
        if (typeof skill.name !== "string" || !skill.name.trim()) return []
        return [{ id: skill.id, name: skill.name.slice(0, 160), description: typeof skill.description === "string" ? skill.description.slice(0, 400) : "" }]
      })
    : []
  const catalog = normalizeCatalog(record.catalog)
  const directories = Array.isArray(record.directories)
    ? record.directories.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const directory = item as { id?: unknown; label?: unknown }
        if (typeof directory.id !== "string" || !handlePattern.test(directory.id)) return []
        const label = displayText(directory.label, 160)
        if (!label) return []
        return [{ id: directory.id, label }]
      })
    : []
  const side = record.sideQuestion
  const sideStatus = side && typeof side === "object" ? (side as SideQuestionView).status : null
  const sideQuestion = side && typeof side === "object" && (sideStatus === "starting" || sideStatus === "running" || sideStatus === "stopping" || sideStatus === "completed" || sideStatus === "interrupted" || sideStatus === "failed" || sideStatus === "incomplete")
    ? {
        question: typeof (side as SideQuestionView).question === "string" ? (side as SideQuestionView).question.slice(0, 4000) : "",
        answer: typeof (side as SideQuestionView).answer === "string" ? (side as SideQuestionView).answer.slice(0, 16000) : "",
        status: sideStatus,
      }
    : null
  return {
    skills,
    selectedSkill: typeof record.selectedSkill === "string" && handlePattern.test(record.selectedSkill) ? record.selectedSkill : null,
    catalog,
    directories,
    busy: boundedText(record.busy, 80),
    sideQuestion,
  }
}

function catalogRows(value: unknown): CatalogRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as CatalogRow
    const label = displayText(row.label, 160)
    if (!label) return []
    return [{ label, detail: typeof row.detail === "string" ? row.detail.slice(0, 400) : "" }]
  })
}

function normalizeCatalog(value: unknown): CatalogSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as CatalogSnapshot
  if (!catalogKinds.some((kind) => kind === record.kind)) return null
  const loading = record.loading === "refresh" || record.loading === "turns" || record.loading === "items" ? record.loading : record.loading === null ? null : undefined
  const pages = record.pages && typeof record.pages === "object"
    ? {
        turns: normalizeLivePage((record.pages as { turns?: unknown }).turns),
        items: normalizeLivePage((record.pages as { items?: unknown }).items),
      }
    : undefined
  return {
    kind: record.kind,
    loaded: record.loaded !== false,
    stale: record.stale === true,
    rows: catalogRows(record.rows),
    ...(typeof record.snapshotId === "string" && safeId(record.snapshotId) ? { snapshotId: record.snapshotId } : {}),
    ...(loading !== undefined ? { loading } : {}),
    ...(typeof record.error === "string" ? { error: record.error.slice(0, 400) } : record.error === null ? { error: null } : {}),
    ...(pages ? { pages } : {}),
  }
}

function normalizeLivePage(value: unknown): LiveSnapshotPageView {
  const record = value && typeof value === "object" ? value as Partial<LiveSnapshotPageView> : {}
  return {
    rows: catalogRows(record.rows),
    total: typeof record.total === "number" && record.total >= 0 ? record.total : 0,
    hasMore: record.hasMore === true,
  }
}

const taskPhases: readonly BackgroundTaskPhase[] = ["queued", "started", "skipped", "cancelled", "notFound", "noop"]

function normalizeBackgroundTasks(value: unknown): BackgroundTaskView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as BackgroundTaskView
    if (typeof row.id !== "string" || !handlePattern.test(row.id)) return []
    if (typeof row.label !== "string" || !row.label.trim()) return []
    const phase = taskPhases.find((item) => item === row.phase)
    if (!phase) return []
    return [{ id: row.id, label: row.label.slice(0, 160), phase }]
  })
}

function normalizeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > 160 || item.includes("..")) return []
    return [item.slice(0, 160)]
  })
}

/** 与宿主 MessageQueue 的上限一致；超出的条目不显示。 */
const MAX_QUEUED_MESSAGES = 20

function normalizeMessageQueue(value: unknown): MessageQueueView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as { items?: unknown; paused?: unknown }
  const items = Array.isArray(record.items)
    ? record.items.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const row = item as { id?: unknown; text?: unknown }
        if (typeof row.id !== "string" || !handlePattern.test(row.id)) return []
        if (typeof row.text !== "string" || !row.text.trim() || row.text.length > 32_000) return []
        return [{ id: row.id, text: row.text }]
      }).slice(0, MAX_QUEUED_MESSAGES)
    : []
  return { items, paused: record.paused === true && items.length > 0 }
}

function normalizeSubmission(value: unknown): SubmissionReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as SubmissionReceipt
  if (typeof record.requestId !== "string" || !requestIdPattern.test(record.requestId)) return null
  if (typeof record.accepted !== "boolean") return null
  return { requestId: record.requestId, accepted: record.accepted }
}

export function asSnapshot(value: unknown): ChatSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Partial<ChatSnapshot> & { type?: unknown }
  if (record.type !== "state") return null
  const base = initialSnapshot()
  const thread = typeof record.threadId === "string" && threadIdPattern.test(record.threadId) ? record.threadId : null
  const resume = typeof record.resumeThreadId === "string" && threadIdPattern.test(record.resumeThreadId) ? record.resumeThreadId : null
  return {
    type: "state",
    phase: normalizePhase(record.phase),
    workspace: displayText(record.workspace, 160),
    space: displayText(record.space, 160),
    threadId: thread,
    resumeThreadId: resume,
    model: boundedText(record.model, 160),
    effort: record.effort === "low" || record.effort === "medium" || record.effort === "high" || record.effort === "xhigh" ? record.effort : base.effort,
    permission: record.permission === "default" || record.permission === "auto" || record.permission === "yolo" ? record.permission : base.permission,
    workMode: record.workMode === "plan" ? "plan" : "default",
    modeRevision: typeof record.modeRevision === "number" && Number.isFinite(record.modeRevision) ? record.modeRevision : null,
    notice: typeof record.notice === "string" ? record.notice.slice(0, 4000) : null,
    version: typeof record.version === "number" && Number.isFinite(record.version) && record.version >= 0 ? record.version : base.version,
    theme: record.theme === "dark" ? "dark" : "light",
    assistantText: typeof record.assistantText === "string" ? record.assistantText.slice(0, 64_000) : "",
    messages: normalizeMessages(record.messages ?? base.messages),
    turnTimings: normalizeTimings(record.turnTimings ?? base.turnTimings),
    account: normalizeAccount(record.account ?? base.account),
    accountRequest: typeof record.accountRequest === "number" && Number.isSafeInteger(record.accountRequest) && record.accountRequest >= 0 ? record.accountRequest : base.accountRequest,
    permissionMenuRequest: typeof record.permissionMenuRequest === "number" && Number.isSafeInteger(record.permissionMenuRequest) && record.permissionMenuRequest >= 0 ? record.permissionMenuRequest : base.permissionMenuRequest,
    brandMark: typeof record.brandMark === "string" ? record.brandMark : base.brandMark,
    slashCommands: normalizeSlashCommands(record.slashCommands ?? base.slashCommands),
    pendingInteraction: boundedText(record.pendingInteraction, 100),
    pendingPanel: normalizePanel(record.pendingPanel),
    submission: normalizeSubmission(record.submission),
    messageQueue: normalizeMessageQueue(record.messageQueue),
    canRetry: record.canRetry === true,
    canResume: record.canResume === true,
    canLoadOlder: record.canLoadOlder === true,
    pluginManagement: normalizePluginManagement(record.pluginManagement),
    conversationSearch: normalizeConversationSearch(record.conversationSearch),
    hasOlderMessages: record.hasOlderMessages === true,
    historyNeedsRefresh: record.historyNeedsRefresh === true,
    composerCatalog: {
      models: normalizeChoices(record.composerCatalog?.models),
      spaces: normalizeChoices(record.composerCatalog?.spaces),
    },
    capabilities: normalizeCapabilities(record.capabilities),
    sessionTools: normalizeSessionTools(record.sessionTools),
    attachments: normalizeAttachments(record.attachments),
    selections: normalizeSelections(record.selections ?? base.selections),
    diffs: normalizeDiffs(record.diffs),
    background: normalizeBackground(record.background),
    backgroundTasks: normalizeBackgroundTasks(record.backgroundTasks),
    backgroundBusy: record.backgroundBusy === true,
    tools: normalizeNames(record.tools),
    mcpNames: normalizeNames(record.mcpNames),
    history: normalizeHistory(record.history),
    fileSearch: normalizeFileSearch(record.fileSearch),
    sendKey: record.sendKey === "modEnter" ? "modEnter" : "enter",
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

function normalizeConversationSearch(value: unknown): ConversationSearchView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as ConversationSearchView
  if (!["idle", "loading", "ready", "error"].includes(row.status) || typeof row.query !== "string" || !Array.isArray(row.hits)) return null
  return {
    open: row.open === true, status: row.status, query: row.query.slice(0, 512),
    hits: row.hits.slice(0, 200).flatMap(hit => hit && typeof hit.id === "string" && handlePattern.test(hit.id) && (hit.role === "user" || hit.role === "assistant") && typeof hit.excerpt === "string" ? [{ id: hit.id, role: hit.role, excerpt: hit.excerpt.slice(0, 800) }] : []),
    truncated: row.truncated === true, error: typeof row.error === "string" ? row.error.slice(0, 500) : null,
    target: typeof row.target === "string" ? row.target.slice(0, 500) : null, historical: row.historical === true,
  }
}

function normalizePluginManagement(value: unknown): PluginManagementView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const view = value as PluginManagementView
  if (!["idle", "loading", "mutating", "reconciling", "ready", "error"].includes(view.status) || !Array.isArray(view.entries) || !Array.isArray(view.skills)) return null
  return {
    open: view.open === true, loaded: view.loaded === true, status: view.status,
    entries: view.entries.slice(0, 1000).flatMap(row => row && typeof row.id === "string" && handlePattern.test(row.id) && typeof row.name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(row.name) && typeof row.enabled === "boolean" ? [{ id: row.id, name: row.name, enabled: row.enabled, version: typeof row.version === "string" ? row.version.slice(0, 100) : null }] : []),
    skills: view.skills.slice(0, 1000).flatMap(row => row && typeof row.name === "string" && typeof row.description === "string" ? [{ name: row.name.slice(0, 200), description: row.description.slice(0, 1000) }] : []),
    error: typeof view.error === "string" ? view.error.slice(0, 1000) : null,
    notice: typeof view.notice === "string" ? view.notice.slice(0, 1000) : null,
  }
}
