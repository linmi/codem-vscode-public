import type { JsonObject } from "./rpc.ts"

export const APP_SERVER_ITEM_TYPES = [
  "userMessage",
  "agentMessage",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "webSearch",
  "contextCompaction",
  "toolCall",
  "toolResult",
  "subagent",
] as const

export const APP_SERVER_ITEM_STATUSES = ["inProgress", "completed", "failed", "declined", "interrupted"] as const

export type AppServerItemType = (typeof APP_SERVER_ITEM_TYPES)[number]
export type AppServerItemStatus = (typeof APP_SERVER_ITEM_STATUSES)[number]

export type AppServerJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly AppServerJsonValue[]
  | { readonly [key: string]: AppServerJsonValue }

export interface AppServerFinalAnswerArtifact {
  readonly kind: "file" | "image" | "chart" | "url"
  readonly title: string
  readonly source: string | null
  readonly uri: string | null
  readonly path: string | null
  readonly filename: string | null
  readonly alt: string | null
  readonly mime: string | null
  readonly spec: AppServerJsonValue
}

export interface AppServerFinalAnswer {
  readonly status: "complete" | "partial" | "blocked"
  readonly kind: "chat" | "task"
  readonly summary: string
  readonly artifacts: readonly AppServerFinalAnswerArtifact[]
}

/**
 * Stable CodeM projection of an App Server item. Dynamic tool arguments stay
 * behind this Host boundary and are copied into a JSON object; the raw protocol
 * item is never forwarded to an editor Webview.
 */
export interface AppServerItem {
  readonly id: string
  readonly type: AppServerItemType
  readonly status: AppServerItemStatus
  readonly callId: string | null
  readonly toolName: string | null
  readonly label: string
  readonly input: Readonly<JsonObject> | null
  readonly text: string
  readonly summary: string
  readonly output: string
  readonly isError: boolean
  readonly subagentId: string | null
  readonly subagentKind: string | null
  readonly replaced: number | null
  readonly kept: number | null
  readonly finalAnswer: AppServerFinalAnswer | null
}

export type AppServerFileChangeType =
  | "new"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"

export interface AppServerFileDiffLine {
  readonly kind: "context" | "insert" | "delete"
  readonly oldLine: number | null
  readonly newLine: number | null
  readonly text: string
}

export interface AppServerFileDiffHunk {
  readonly oldStart: number
  readonly oldCount: number
  readonly newStart: number
  readonly newCount: number
  readonly lines: readonly AppServerFileDiffLine[]
}

export type AppServerFileDiffPreview =
  | { readonly kind: "binary" }
  | { readonly kind: "complete"; readonly hunks: readonly AppServerFileDiffHunk[] }
  | { readonly kind: "partial"; readonly hunks: readonly AppServerFileDiffHunk[] }
  | { readonly kind: "raw-partial"; readonly text: string }
  | { readonly kind: "omitted" }

export type AppServerFileDiffSource =
  | { readonly kind: "tool"; readonly toolCallId: string }
  | {
      readonly kind: "background-tool"
      readonly backgroundTaskId: string
      readonly toolCallId: string
    }

export interface AppServerFileDiff {
  readonly source: AppServerFileDiffSource
  readonly path: string
  readonly changeType: AppServerFileChangeType
  readonly stats: { readonly linesAdded: number; readonly linesRemoved: number }
  readonly preview: AppServerFileDiffPreview
}

export interface AppServerToolGuard {
  readonly toolName: string
  readonly toolCallId: string
  readonly status: string
  readonly reason: string
  readonly rawResultBytes: number | null
  readonly returnedResultBytes: number
  readonly formattedCapBytes: number | null
  readonly globalBackstopApplied: boolean
  readonly suggestion: string | null
}

export function parseAppServerItem(value: unknown, label: string): AppServerItem {
  const item = objectValue(value, label)
  const type = enumValue(item.type, APP_SERVER_ITEM_TYPES, `${label}.type`)
  const status = enumValue(item.status, APP_SERVER_ITEM_STATUSES, `${label}.status`)
  const protocolTool = optionalString(item.tool)
  const toolName = protocolTool ?? (type === "subagent" ? "dispatch" : type === "contextCompaction" ? "compact" : null)
  const callId =
    optionalString(item.callId) ??
    optionalString(item.subagentId) ??
    (toolName ? nonBlankString(item.id, `${label}.id`) : null)
  const input =
    objectOrNull(item.arguments, `${label}.arguments`) ??
    (type === "subagent"
      ? compactObject({ label: optionalString(item.label), kind: optionalString(item.subagentKind) })
      : type === "contextCompaction"
        ? compactObject({
            replaced: optionalNonNegativeInteger(item.replaced),
            kept: optionalNonNegativeInteger(item.kept),
          })
        : null)
  const isError = booleanOrDefault(item.isError, status === "failed")
  const finalAnswer = toolName === "final_answer" && input ? parseFinalAnswer(input, `${label}.arguments`) : null
  return {
    id: nonBlankString(item.id, `${label}.id`),
    type,
    status,
    callId,
    toolName,
    label: optionalString(item.label) ?? toolName ?? type,
    input,
    text: optionalString(item.text) ?? "",
    summary: boundedText(item.summary),
    output: boundedText(item.output),
    isError,
    subagentId: optionalString(item.subagentId),
    subagentKind: optionalString(item.subagentKind),
    replaced: optionalNonNegativeInteger(item.replaced),
    kept: optionalNonNegativeInteger(item.kept),
    finalAnswer,
  }
}

export function mergeAppServerItems(started: AppServerItem | undefined, completed: AppServerItem): AppServerItem {
  if (!started) return completed
  if (started.id !== completed.id || started.type !== completed.type) {
    throw new Error(`CodeM App Server item ${completed.id} changed identity or type`)
  }
  if (started.callId && completed.callId && started.callId !== completed.callId) {
    throw new Error(`CodeM App Server item ${completed.id} changed callId`)
  }
  return {
    ...completed,
    callId: completed.callId ?? started.callId,
    toolName: completed.toolName ?? started.toolName,
    label: completed.label === completed.type ? started.label : completed.label,
    input: completed.input ?? started.input,
    subagentId: completed.subagentId ?? started.subagentId,
    subagentKind: completed.subagentKind ?? started.subagentKind,
    replaced: completed.replaced ?? started.replaced,
    kept: completed.kept ?? started.kept,
    finalAnswer: completed.finalAnswer ?? started.finalAnswer,
  }
}

function parseFinalAnswer(value: Readonly<JsonObject> | null, label: string): AppServerFinalAnswer {
  const answer = objectValue(value, label)
  requireOnlyFields(answer, ["status", "kind", "summary", "artifacts"], label)
  const status =
    answer.status === undefined
      ? "complete"
      : enumValue(answer.status, ["complete", "partial", "blocked"] as const, `${label}.status`)
  const kind = answer.kind === "chat" ? "chat" : "task"
  const summary = nonBlankString(answer.summary, `${label}.summary`)
  const artifacts = (answer.artifacts === undefined ? [] : arrayValue(answer.artifacts, `${label}.artifacts`)).map(
    (artifact, index) => parseFinalAnswerArtifact(artifact, `${label}.artifacts[${index}]`),
  )
  return { status, kind, summary, artifacts }
}

function parseFinalAnswerArtifact(value: unknown, label: string): AppServerFinalAnswerArtifact {
  const artifact = objectValue(value, label)
  requireOnlyFields(artifact, ["kind", "title", "source", "uri", "path", "filename", "alt", "mime", "spec"], label)
  return {
    kind: enumValue(artifact.kind, ["file", "image", "chart", "url"] as const, `${label}.kind`),
    title: stringValue(artifact.title, `${label}.title`),
    source: nullableOptionalString(artifact.source, `${label}.source`),
    uri: nullableOptionalString(artifact.uri, `${label}.uri`),
    path: nullableOptionalString(artifact.path, `${label}.path`),
    filename: nullableOptionalString(artifact.filename, `${label}.filename`),
    alt: nullableOptionalString(artifact.alt, `${label}.alt`),
    mime: nullableOptionalString(artifact.mime, `${label}.mime`),
    spec: jsonValue(artifact.spec, `${label}.spec`),
  }
}

export function parseAppServerToolGuard(value: unknown, callId: unknown, label: string): AppServerToolGuard {
  const guard = objectValue(value, label)
  return {
    toolName: nonBlankString(guard.tool, `${label}.tool`),
    toolCallId: nonBlankString(callId, `${label}.callId`),
    status: nonBlankString(guard.status, `${label}.status`),
    reason: stringValue(guard.reason, `${label}.reason`),
    rawResultBytes: nullableNonNegativeInteger(guard.rawResultBytes, `${label}.rawResultBytes`),
    returnedResultBytes: nonNegativeInteger(guard.returnedResultBytes, `${label}.returnedResultBytes`),
    formattedCapBytes: nullableNonNegativeInteger(guard.formattedCapBytes, `${label}.formattedCapBytes`),
    globalBackstopApplied: booleanValue(guard.globalBackstopApplied, `${label}.globalBackstopApplied`),
    suggestion: nullableString(guard.suggestion, `${label}.suggestion`),
  }
}

export function parseAppServerFileDiff(
  value: unknown,
  expectedCallId: string,
  expectedBackgroundTaskId: string | null,
  label: string,
): AppServerFileDiff {
  const persisted = objectValue(value, label)
  const toolCallId = nonBlankString(persisted.tool_call_id, `${label}.tool_call_id`)
  if (toolCallId !== expectedCallId) throw new Error(`CodeM App Server ${label} changed tool_call_id`)
  const backgroundTaskId = optionalString(persisted.background_task_id)
  if (backgroundTaskId !== expectedBackgroundTaskId) {
    throw new Error(`CodeM App Server ${label} changed background_task_id`)
  }
  const isBinary = booleanValue(persisted.is_binary, `${label}.is_binary`)
  const truncated = booleanValue(persisted.truncated, `${label}.truncated`)
  const stats = objectValue(persisted.stats, `${label}.stats`)
  const hunks = arrayValue(persisted.hunks, `${label}.hunks`).map((entry, index) =>
    parseHunk(entry, `${label}.hunks[${index}]`),
  )
  if (isBinary && hunks.length > 0) throw new Error(`CodeM App Server ${label} binary diff contains text hunks`)
  const linesAdded = nonNegativeInteger(stats.lines_added, `${label}.stats.lines_added`)
  const linesRemoved = nonNegativeInteger(stats.lines_removed, `${label}.stats.lines_removed`)
  const observedAdded = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "insert").length,
    0,
  )
  const observedRemoved = hunks.reduce(
    (total, hunk) => total + hunk.lines.filter((line) => line.kind === "delete").length,
    0,
  )
  if (!truncated && !isBinary && (observedAdded !== linesAdded || observedRemoved !== linesRemoved)) {
    throw new Error(`CodeM App Server ${label} stats do not match complete hunks`)
  }
  if (truncated && (observedAdded > linesAdded || observedRemoved > linesRemoved)) {
    throw new Error(`CodeM App Server ${label} partial hunks exceed diff stats`)
  }
  const rawUnified = nullableString(persisted.raw_unified, `${label}.raw_unified`)
  const preview: AppServerFileDiffPreview = isBinary
    ? { kind: "binary" }
    : !truncated
      ? { kind: "complete", hunks }
      : hunks.length > 0
        ? { kind: "partial", hunks }
        : rawUnified?.trim()
          ? { kind: "raw-partial", text: rawUnified }
          : { kind: "omitted" }
  return {
    source: backgroundTaskId ? { kind: "background-tool", backgroundTaskId, toolCallId } : { kind: "tool", toolCallId },
    path: nonBlankString(persisted.path, `${label}.path`),
    changeType: enumValue(
      persisted.change_type,
      ["new", "modified", "deleted", "renamed", "copied", "type-changed", "unmerged"] as const,
      `${label}.change_type`,
    ),
    stats: { linesAdded, linesRemoved },
    preview,
  }
}

function parseHunk(value: unknown, label: string): AppServerFileDiffHunk {
  const hunk = objectValue(value, label)
  const oldStart = nonNegativeInteger(hunk.old_start, `${label}.old_start`)
  const oldCount = nonNegativeInteger(hunk.old_count, `${label}.old_count`)
  const newStart = nonNegativeInteger(hunk.new_start, `${label}.new_start`)
  const newCount = nonNegativeInteger(hunk.new_count, `${label}.new_count`)
  if ((oldCount === 0 ? oldStart !== 0 : oldStart < 1) || (newCount === 0 ? newStart !== 0 : newStart < 1)) {
    throw new Error(`CodeM App Server ${label} has invalid start/count pairs`)
  }
  const lines = arrayValue(hunk.lines, `${label}.lines`).map((entry, index) =>
    parseLine(entry, `${label}.lines[${index}]`),
  )
  let expectedOld = oldStart
  let expectedNew = newStart
  let observedOld = 0
  let observedNew = 0
  for (const line of lines) {
    if (line.oldLine !== null) {
      if (line.oldLine !== expectedOld) throw new Error(`CodeM App Server ${label} old lines are not contiguous`)
      expectedOld += 1
      observedOld += 1
    }
    if (line.newLine !== null) {
      if (line.newLine !== expectedNew) throw new Error(`CodeM App Server ${label} new lines are not contiguous`)
      expectedNew += 1
      observedNew += 1
    }
  }
  if (observedOld !== oldCount || observedNew !== newCount) {
    throw new Error(`CodeM App Server ${label} line counts do not match its header`)
  }
  return { oldStart, oldCount, newStart, newCount, lines }
}

function parseLine(value: unknown, label: string): AppServerFileDiffLine {
  const line = objectValue(value, label)
  const kind = enumValue(line.kind, ["context", "insert", "delete"] as const, `${label}.kind`)
  const oldLine = nullablePositiveInteger(line.old_line, `${label}.old_line`)
  const newLine = nullablePositiveInteger(line.new_line, `${label}.new_line`)
  const valid =
    (kind === "insert" && oldLine === null && newLine !== null) ||
    (kind === "delete" && oldLine !== null && newLine === null) ||
    (kind === "context" && oldLine !== null && newLine !== null)
  if (!valid) throw new Error(`CodeM App Server ${label} line numbers do not match ${kind}`)
  return { kind, oldLine, newLine, text: stringValue(line.text, `${label}.text`) }
}

function compactObject(value: Record<string, unknown>): Readonly<JsonObject> | null {
  const entries = Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined)
  return entries.length === 0 ? null : Object.fromEntries(entries)
}

function objectOrNull(value: unknown, label: string): Readonly<JsonObject> | null {
  if (value === undefined || value === null) return null
  return objectValue(value, label)
}

function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`CodeM App Server ${label} must be an object`)
  }
  return value as JsonObject
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`CodeM App Server ${label} must be an array`)
  return value
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`CodeM App Server ${label} has invalid value ${String(value)}`)
  }
  return value as Values[number]
}

function nonBlankString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`CodeM App Server ${label} must be non-empty`)
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`CodeM App Server ${label} must be a string`)
  return value
}

function nullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return stringValue(value, label)
}

function nullableOptionalString(value: unknown, label: string): string | null {
  return value === undefined || value === null ? null : stringValue(value, label)
}

function requireOnlyFields(value: JsonObject, allowedFields: readonly string[], label: string): void {
  const allowed = new Set(allowedFields)
  const unexpected = Object.keys(value).filter((field) => !allowed.has(field))
  if (unexpected.length > 0) {
    throw new Error(`CodeM App Server ${label} has unsupported fields: ${unexpected.join(", ")}`)
  }
}

function jsonValue(value: unknown, label: string): AppServerJsonValue {
  if (value === undefined || value === null) return null
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${label}[${index}]`))
  const object = objectValue(value, label)
  return Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, jsonValue(entry, `${label}.${key}`)]))
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`CodeM App Server ${label} must be a boolean`)
  return value
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`CodeM App Server ${label} must be a non-negative integer`)
  }
  return value
}

function optionalNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

function nullableNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  return nonNegativeInteger(value, label)
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`CodeM App Server ${label} must be a positive integer or null`)
  }
  return value
}

function boundedText(value: unknown): string {
  const text = typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value)
  return text.length <= 8_000 ? text : `${text.slice(0, 8_000)}…`
}
