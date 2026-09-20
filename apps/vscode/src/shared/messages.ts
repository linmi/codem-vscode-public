import { CODEM_DEFAULT_INTELLIGENCE, parseCodemIntelligence, parseCodemPermissionMode, type CodemBuiltinIntelligence } from "@codem/protocol"
import { parseWorkMode, type ComposerSettingAction, type ComposerCatalog } from "./composerSettings.ts"
import { emptySessionTools, parseCapabilityAction, type CapabilityAction, type SessionToolsState, emptyCapabilities, type CapabilityState } from "./capabilityTypes.ts"
import { parsePanelReply, type PanelReply } from "./panelTypes.ts"
import { emptyHistoryList, type HistoryAction, type HistoryList } from "./historyTypes.ts"

/** The webview sends intent and opaque handles. Paths, credentials and RPC stay in Host. */
const simpleActions = ["showHistory", "closeHistory", "refreshHistory", "moreThreads", "olderMessages", "reloadHistory", "ready", "connect", "signIn", "newChat", "stop", "showOutput", "refreshSpaces", "manageMcp", "refreshTools", "refreshBackground", "cleanBackground"] as const
const handleActions = ["chooseModel", "chooseSpace", "openArtifact", "loadImage", "removeAttachment", "openDiff", "openChangedFile", "openBackgroundLog", "terminateBackground", "cancelBackgroundTask", "removeCodeSelection", "revealCodeSelection"] as const
export interface ComposerDraft { draft: string; tools?: { scope: string; text: string; mode: "askSideQuestion" | "steer" | "shellCommand" } }
export interface CodeSelectionView { id: string; label: string; path: string; startLine: number; endLine: number; error: string | null }
export type EditorMessage = { type: "codeSelection"; value: CodeSelectionView | null } | { type: "composerDraft"; value: ComposerDraft; focus: boolean; pendingRequestId: string | null } | { type: "appendContext"; id: string; text: string } | { type: "focusComposer" } | { type: "editorSettings"; sendKey: string }
export type ViewAction =
  | ComposerSettingAction
  | { type: "pickAttachment"; kind: "file" | "directory" }
  | { type: "contextAdded"; id: string; accepted: boolean; value: ComposerDraft }
  | { type: "composerChanged" | "composerRestore"; value: ComposerDraft }
  | CapabilityAction
  | PanelReply
  | HistoryAction
  | { type: typeof simpleActions[number] }
  | { type: typeof handleActions[number]; id: string }
  | { type: "searchFiles"; query: string; requestId: string }
  | { type: "selectFile"; id: string; requestId: string }
  | { type: "send"; text: string; requestId: string; selectionId?: string }

export interface ImageResult { type: "imageResult"; id: string; preview: AttachmentView["preview"] }
export interface FileSearchResult { type: "fileSearchResult"; requestId: string; files: readonly { id: string; label: string }[]; error: string | null }
export interface FileSelected { type: "fileSelected"; requestId: string; accepted: boolean }
export interface SendResult { type: "sendResult"; requestId: string; accepted: boolean }

export function parseViewAction(value: unknown): ViewAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid CodeM action")
  const record = value as Record<string, unknown>
  if (record.type === "contextAdded") {
    if (Object.keys(record).length !== 4 || typeof record.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(record.id) || typeof record.accepted !== "boolean") throw new Error("Invalid context receipt")
    const draft = parseViewAction({ type: "composerChanged", value: record.value })
    if (draft.type !== "composerChanged") throw new Error("Invalid context draft")
    return { type: "contextAdded", id: record.id, accepted: record.accepted, value: draft.value }
  }
  if (record.type === "composerChanged" || record.type === "composerRestore") {
    const value = record.value as ComposerDraft | undefined
    if (Object.keys(record).length !== 2 || !value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "draft" && key !== "tools") || typeof value.draft !== "string" || value.draft.length > 32_000) throw new Error("Invalid composer draft")
    const t = value.tools
    if (t !== undefined && (!t || typeof t !== "object" || Object.keys(t).length !== 3 || typeof t.scope !== "string" || t.scope.length > 1000 || typeof t.text !== "string" || t.text.length > 32_000 || !["askSideQuestion", "steer", "shellCommand"].includes(t.mode))) throw new Error("Invalid tools draft")
    return { type: record.type, value }
  }
  if (record.type === "setWorkMode" && Object.keys(record).length === 2) return { type: "setWorkMode", workMode: parseWorkMode(record.workMode) }
  if (record.type === "setPermission" && Object.keys(record).length === 2) return { type: "setPermission", permission: parseCodemPermissionMode(record.permission) }
  if (record.type === "pickAttachment" && Object.keys(record).length === 2 && (record.kind === "file" || record.kind === "directory")) return { type: "pickAttachment", kind: record.kind }
  if (record.type === "setEffort" && Object.keys(record).length === 2) return { type: "setEffort", effort: parseCodemIntelligence(record.effort) }
  if (record.type === "panelReply") return parsePanelReply(record)
  const capability = parseCapabilityAction(record)
  if (capability) return capability
  const keys = Object.keys(record)
  if (keys.length === 3 && typeof record.requestId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(record.requestId)) {
    if (record.type === "searchFiles" && typeof record.query === "string" && record.query.length <= 200 && ![...record.query].some(character => character.charCodeAt(0) < 32)) return { type: "searchFiles", query: record.query, requestId: record.requestId }
    if (record.type === "selectFile" && typeof record.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(record.id)) return { type: "selectFile", id: record.id, requestId: record.requestId }
  }
  if (record.type === "send" && (keys.length === 3 && record.selectionId === undefined || keys.length === 4 && typeof record.selectionId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(record.selectionId)) && typeof record.requestId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(record.requestId) && typeof record.text === "string" && record.text.trim() && record.text.length <= 32_000) return { type: "send", text: record.text, requestId: record.requestId, ...(typeof record.selectionId === "string" ? { selectionId: record.selectionId } : {}) }
  if (record.type === "resumeThread" && keys.length === 2 && typeof record.threadId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(record.threadId)) return { type: "resumeThread", threadId: record.threadId }
  if (keys.length === 1 && simpleActions.some((type) => type === record.type)) return record as ViewAction
  if (keys.length === 2 && handleActions.some((type) => type === record.type) && typeof record.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(record.id)) return record as ViewAction
  throw new Error("Unsupported CodeM action")
}

export type ChatPhase = "sideQuestion" | "loadingHistory" | "disconnected" | "connecting" | "configuring" | "ready" | "sending" | "running" | "stopping"
export interface AttachmentView { id: string; label: string; kind: "image" | "file" | "directory"; preview: { kind: "deferred" } | { kind: "none" } | { kind: "image"; dataUrl: string } | { kind: "unavailable"; reason: string } }
export interface DiffView { id: string; turnId: string; label: string; added: number; removed: number; preview: "complete" | "partial" | "raw-partial" | "binary" | "omitted"; available: boolean }
export interface BackgroundView { id: string; label: string; inProgress: boolean }
export interface BackgroundTaskView { id: string; label: string; phase: "queued" | "started" | "skipped" | "cancelled" | "notFound" | "noop" }
export type ActivityStatus = "running" | "completed" | "failed" | "declined" | "interrupted" | "incomplete"
export interface ToolDetails { kind: "command" | "file" | "search" | "web" | "mcp" | "subagent"; fields: readonly { label: string; value: string }[]; code: string | null }
export interface ArtifactView { id: string; kind: "file" | "image" | "chart" | "url" | "diff"; title: string; detail: string; available: boolean }
/** Host-observed live interval or durable Core interval; finish also records an interrupted connection. */
export interface TurnTiming { turnId: string; startedAt: number; finishedAt: number | null }
interface MessageContent {
  /** Absent only until Core accepts a pending user submission, or in timing-free fixtures. */
  turnId?: string
  artifacts?: readonly ArtifactView[]
  id: string
  label: string
  text: string
}
export type ActivityMessage = MessageContent & { role: "reasoning" | "tool"; status: ActivityStatus; summary: string; details?: ToolDetails }
export type ChatMessage = (MessageContent & { role: "user" | "assistant"; attachments?: readonly AttachmentView[] }) | ActivityMessage
export interface ChatSnapshot {
  composerCatalog: ComposerCatalog
  capabilities: CapabilityState
  sessionTools: SessionToolsState
  type: "state"
  phase: ChatPhase
  space: string | null
  workspace: string | null
  model: string | null
  effort: CodemBuiltinIntelligence
  permission: "default" | "auto" | "yolo"
  workMode: "default" | "plan"
  mcpNames: readonly string[]
  tools: readonly string[]
  attachments: readonly AttachmentView[]
  diffs: readonly DiffView[]
  background: readonly BackgroundView[]
  backgroundTasks: readonly BackgroundTaskView[]
  backgroundBusy: boolean
  messages: readonly ChatMessage[]
  turnTimings: readonly TurnTiming[]
  notice: string | null
  threadId: string | null
  history: HistoryList
  hasOlderMessages: boolean
  historyNeedsRefresh: boolean
}
export function initialSnapshot(): ChatSnapshot {
  return { composerCatalog: { models: [], spaces: [] }, capabilities: emptyCapabilities(), sessionTools: emptySessionTools(), threadId: null, history: emptyHistoryList(), hasOlderMessages: false, historyNeedsRefresh: false, type: "state", phase: "disconnected", workspace: null, space: null, model: null, effort: CODEM_DEFAULT_INTELLIGENCE, permission: "default", workMode: "default", mcpNames: [], tools: [], attachments: [], diffs: [], background: [], backgroundTasks: [], backgroundBusy: false, messages: [], turnTimings: [], notice: null }
}
export function isBusy(phase: ChatPhase): boolean {
  return phase !== "ready" && phase !== "disconnected"
}
