import { parsePanelReply, type PanelReply } from "./panelTypes.ts"
import { emptyHistoryList, type HistoryAction, type HistoryList } from "./historyTypes.ts"

/** The webview sends intent and opaque handles. Paths, credentials and RPC stay in Host. */
const simpleActions = ["showHistory", "closeHistory", "refreshHistory", "moreThreads", "olderMessages", "reloadHistory", "ready", "connect", "signIn", "newChat", "stop", "showOutput", "selectModel", "selectEffort", "selectPermission", "selectWorkMode", "addAttachment", "manageMcp", "refreshTools", "refreshBackground", "cleanBackground"] as const
const handleActions = ["openArtifact", "loadImage", "removeAttachment", "openDiff", "openChangedFile", "openBackgroundLog", "terminateBackground", "cancelBackgroundTask"] as const
export type ViewAction =
  | PanelReply
  | HistoryAction
  | { type: typeof simpleActions[number] }
  | { type: typeof handleActions[number]; id: string }
  | { type: "searchFiles"; query: string; requestId: string }
  | { type: "selectFile"; id: string; requestId: string }
  | { type: "send"; text: string; requestId: string }

export interface ImageResult { type: "imageResult"; id: string; preview: AttachmentView["preview"] }
export interface FileSearchResult { type: "fileSearchResult"; requestId: string; files: readonly { id: string; label: string }[]; error: string | null }
export interface FileSelected { type: "fileSelected"; requestId: string; accepted: boolean }
export interface SendResult { type: "sendResult"; requestId: string; accepted: boolean }

export function parseViewAction(value: unknown): ViewAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid CodeM action")
  const record = value as Record<string, unknown>
  if (record.type === "panelReply") return parsePanelReply(record)
  const keys = Object.keys(record)
  if (keys.length === 3 && typeof record.requestId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(record.requestId)) {
    if (record.type === "searchFiles" && typeof record.query === "string" && record.query.length <= 200 && ![...record.query].some(character => character.charCodeAt(0) < 32)) return { type: "searchFiles", query: record.query, requestId: record.requestId }
    if (record.type === "selectFile" && typeof record.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(record.id)) return { type: "selectFile", id: record.id, requestId: record.requestId }
  }
  if (record.type === "send" && keys.length === 3 && typeof record.requestId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(record.requestId) && typeof record.text === "string" && record.text.trim() && record.text.length <= 32_000) return { type: "send", text: record.text, requestId: record.requestId }
  if (record.type === "resumeThread" && keys.length === 2 && typeof record.threadId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(record.threadId)) return { type: "resumeThread", threadId: record.threadId }
  if (keys.length === 1 && simpleActions.some((type) => type === record.type)) return record as ViewAction
  if (keys.length === 2 && handleActions.some((type) => type === record.type) && typeof record.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(record.id)) return record as ViewAction
  throw new Error("Unsupported CodeM action")
}

export type ChatPhase = "loadingHistory" | "disconnected" | "connecting" | "configuring" | "ready" | "sending" | "running" | "stopping"
export interface AttachmentView { id: string; label: string; kind: "image" | "file" | "directory"; preview: { kind: "deferred" } | { kind: "none" } | { kind: "image"; dataUrl: string } | { kind: "unavailable"; reason: string } }
export interface DiffView { id: string; label: string; added: number; removed: number; preview: string }
export interface BackgroundView { id: string; label: string; inProgress: boolean }
export interface BackgroundTaskView { id: string; label: string; phase: "queued" | "started" | "skipped" | "cancelled" | "notFound" | "noop" }
export type ActivityStatus = "running" | "completed" | "failed" | "declined" | "interrupted" | "incomplete"
export interface ToolDetails { kind: "command" | "file" | "search" | "web" | "mcp" | "subagent"; fields: readonly { label: string; value: string }[]; code: string | null }
export interface ArtifactView { id: string; kind: "file" | "image" | "chart" | "url" | "diff"; title: string; detail: string; available: boolean }
interface MessageContent {
  artifacts?: readonly ArtifactView[]
  id: string
  label: string
  text: string
}
export type ActivityMessage = MessageContent & { role: "reasoning" | "tool"; status: ActivityStatus; summary: string; details?: ToolDetails }
export type ChatMessage = (MessageContent & { role: "user" | "assistant"; attachments?: readonly AttachmentView[] }) | ActivityMessage
export interface ChatSnapshot {
  type: "state"
  phase: ChatPhase
  workspace: string | null
  model: string | null
  effort: string
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
  notice: string | null
  threadId: string | null
  history: HistoryList
  hasOlderMessages: boolean
  historyNeedsRefresh: boolean
}
export function initialSnapshot(): ChatSnapshot {
  return { threadId: null, history: emptyHistoryList(), hasOlderMessages: false, historyNeedsRefresh: false, type: "state", phase: "disconnected", workspace: null, model: null, effort: "medium", permission: "default", workMode: "default", mcpNames: [], tools: [], attachments: [], diffs: [], background: [], backgroundTasks: [], backgroundBusy: false, messages: [], notice: null }
}
export function isBusy(phase: ChatPhase): boolean {
  return phase !== "ready" && phase !== "disconnected"
}
