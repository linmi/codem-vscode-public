/** Display-only projections. No credentials, raw RPC objects or filesystem paths. */
export interface CapabilityState {
  plan: readonly { content: string; status: string }[]
  usage: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null } | null
  changes: readonly { label: string; added: number; removed: number }[]
  guards: readonly { id: string; tool: string; status: string; returnedBytes: number; rawBytes: number | null; capped: boolean }[]
  hooks: readonly { id: string; event: string; tool: string | null; outcome: string; elapsedMs: number }[]
  activity: string | null
  threadStatus: string | null
}

export function emptyCapabilities(): CapabilityState {
  return { activity: null, plan: [], usage: null, changes: [], guards: [], hooks: [], threadStatus: null }
}

export const catalogKinds = ["skills", "environment", "config", "hooks", "plugins", "permissions", "spaces", "provider", "live"] as const
export type CatalogKind = typeof catalogKinds[number]
export type ThreadOperation = "rename" | "fork" | "archive" | "unarchive" | "delete"
export interface CatalogRow { label: string; detail: string }
export type LiveSnapshotPageKind = "turns" | "items"
export interface LiveSnapshotPageView { rows: readonly CatalogRow[]; total: number; hasMore: boolean }
export interface LiveCatalogView {
  kind: "live"
  snapshotId: string
  rows: readonly CatalogRow[]
  loaded: boolean
  stale: boolean
  loading: "refresh" | LiveSnapshotPageKind | null
  error: string | null
  pages: { turns: LiveSnapshotPageView; items: LiveSnapshotPageView } | null
}
export type CatalogView = { kind: Exclude<CatalogKind, "live">; rows: readonly CatalogRow[]; loaded: boolean; stale: boolean } | LiveCatalogView
export interface SkillView { id: string; name: string; description: string }
export interface SessionToolsState {
  busy: string | null
  result: { requestId: string; accepted: boolean } | null
  skills: readonly SkillView[]
  selectedSkill: string | null
  catalog: CatalogView | null
  directories: readonly { id: string; label: string }[]
  sideQuestion: { question: string; answer: string; status: "starting" | "running" | "stopping" | "completed" | "interrupted" | "failed" | "incomplete" } | null
}
export function emptySessionTools(): SessionToolsState {
  return { busy: null, result: null, skills: [], selectedSkill: null, catalog: null, directories: [], sideQuestion: null }
}
export type CapabilityAction =
  | { type: "loadCatalog"; kind: CatalogKind }
  | { type: "loadMoreLiveSnapshot"; snapshotId: string; kind: LiveSnapshotPageKind }
  | { type: "cancelLiveSnapshot"; snapshotId: string }
  | { type: "selectSkill"; id: string | null }
  | { type: "manageThread"; operation: ThreadOperation; threadId: string; name: string; requestId: string }
  | { type: "steer" | "askSideQuestion" | "shellCommand"; threadId: string; text: string; requestId: string }
  | { type: "compactThread" | "rewindThread" | "clearThread"; threadId: string; requestId: string }
  | { type: "cancelSideQuestion" | "addDirectory" }
  | { type: "removeDirectory"; id: string }

export function parseCapabilityAction(record: Record<string, unknown>): CapabilityAction | null {
  const keys = Object.keys(record).sort().join(",")
  const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
  if (record.type === "loadCatalog" && keys === "kind,type" && catalogKinds.some(kind => kind === record.kind)) return record as CapabilityAction
  if (record.type === "loadMoreLiveSnapshot" && keys === "kind,snapshotId,type" && identifier(record.snapshotId) && (record.kind === "turns" || record.kind === "items")) return record as CapabilityAction
  if (record.type === "cancelLiveSnapshot" && keys === "snapshotId,type" && identifier(record.snapshotId)) return record as CapabilityAction
  if (record.type === "selectSkill" && keys === "id,type" && (record.id === null || identifier(record.id))) return record as CapabilityAction
  if (record.type === "removeDirectory" && keys === "id,type" && identifier(record.id)) return record as CapabilityAction
  if ((record.type === "cancelSideQuestion" || record.type === "addDirectory") && keys === "type") return record as CapabilityAction
  if (!identifier(record.requestId)) return null
  if (["compactThread", "rewindThread", "clearThread"].includes(String(record.type)) && keys === "requestId,threadId,type" && identifier(record.threadId)) return record as CapabilityAction
  if (["steer", "askSideQuestion", "shellCommand"].includes(String(record.type)) && keys === "requestId,text,threadId,type" && identifier(record.threadId) && typeof record.text === "string" && record.text.trim() && record.text.length <= 32_000) return record as CapabilityAction
  if (record.type === "manageThread" && keys === "name,operation,requestId,threadId,type" && identifier(record.threadId) && ["rename", "fork", "archive", "unarchive", "delete"].includes(String(record.operation)) && typeof record.name === "string" && record.name.length <= 160 && (record.operation === "rename" ? record.name.trim().length > 0 : record.name === "")) return record as CapabilityAction
  return null
}
