import {
  FinalAnswerArtifactSchema,
  FinalAnswerStructuredSchema,
  type FinalAnswerArtifact,
  type FinalAnswerStructured,
} from "../session/index.ts"

export function parseFinalAnswerStructured(
  value: unknown,
  label: string,
): FinalAnswerStructured {
  const record = recordValue(value, label)
  requireOnlyFields(
    record,
    ['status', 'kind', 'summary', 'artifacts'],
    label,
  )
  // Core gives an omitted status `complete` semantics and treats any absent or
  // non-chat kind as `task`, while durable tool_call records keep sparse input.
  // Normalize that wire form to the same Desktop domain result.
  const status = record.status === undefined
    ? 'complete'
    : requiredString(record.status, `${label}.status`)
  if (status !== 'complete' && status !== 'partial' && status !== 'blocked') {
    throw new Error(`${label}.status is unsupported: ${status}`)
  }
  const kind = finalAnswerKind(record.kind, `${label}.kind`)
  const rawArtifacts = record.artifacts
  if (rawArtifacts !== undefined && !Array.isArray(rawArtifacts)) {
    throw new Error(`${label}.artifacts must be an array when present`)
  }
  const structured = {
    status,
    kind,
    summary: requiredString(record.summary, `${label}.summary`),
    // Core 0.8.4 omits artifacts when the final answer has none. Empty is the
    // protocol-defined normalized value, not a Desktop fallback.
    artifacts: (rawArtifacts ?? []).map((artifact, index) =>
      parseFinalAnswerArtifact(artifact, `${label}.artifacts[${index}]`),
    ),
  }
  return FinalAnswerStructuredSchema.parse(structured)
}

function parseFinalAnswerArtifact(
  value: unknown,
  label: string,
): FinalAnswerArtifact {
  const record = recordValue(value, label)
  const kind = requiredString(record.kind, `${label}.kind`)
  const title = stringValue(record.title, `${label}.title`)
  if (kind !== 'file' && kind !== 'image' && kind !== 'chart' && kind !== 'url') {
    throw new Error(`${label}.kind is unsupported: ${kind}`)
  }
  requireOnlyFields(
    record,
    ['kind', 'title', 'source', 'uri', 'path', 'filename', 'alt', 'mime', 'spec'],
    label,
  )
  return FinalAnswerArtifactSchema.parse({
    kind,
    title,
    source: optionalString(record.source, `${label}.source`),
    uri: optionalString(record.uri, `${label}.uri`),
    path: optionalString(record.path, `${label}.path`),
    filename: optionalString(record.filename, `${label}.filename`),
    alt: optionalString(record.alt, `${label}.alt`),
    mime: optionalString(record.mime, `${label}.mime`),
    spec: record.spec ?? null,
  })
}

function finalAnswerKind(value: unknown, label: string): 'chat' | 'task' {
  if (value === undefined || value === null) return 'task'
  return stringValue(value, label) === 'chat' ? 'chat' : 'task'
}

function requireOnlyFields(
  record: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const allowed = new Set(fields)
  const unexpected = Object.keys(record).filter((field) => !allowed.has(field))
  if (unexpected.length > 0) {
    throw new Error(`${label} has unsupported fields: ${unexpected.join(', ')}`)
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  const parsed = stringValue(value, label)
  if (parsed.trim().length === 0) throw new Error(`${label} must be non-empty`)
  return parsed
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function optionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  return stringValue(value, label)
}
