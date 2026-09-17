import {
  requireBoolean,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireNonNegativeNumber,
  requireRecord,
  requireString,
  requireTimestamp,
} from "./fields.ts"
import { sessionFileError } from "./jsonl.ts"

export type KnownMetadataRecordType =
  | 'project_switched'
  | 'redacted_thinking'
  | 'file_read'
  | 'root_added'
  | 'root_removed'
  | 'root_cleared'
  | 'compaction'
  | 'governance_event'
  | 'reviewer_audit'
  | 'background_session_linked'
  | 'rewind_mark'

type KnownMetadataRecordDiscardType = Exclude<
  KnownMetadataRecordType,
  'redacted_thinking'
>

export interface KnownMetadataRecordDiscard {
  readonly disposition: 'validated-discard'
  readonly recordType: KnownMetadataRecordDiscardType
  readonly reason: string
}

export interface KnownMetadataProjectedRedaction {
  readonly disposition: 'projected-redaction'
  readonly recordType: 'redacted_thinking'
  readonly at: string
}

export type KnownMetadataRecordDisposition =
  | KnownMetadataRecordDiscard
  | KnownMetadataProjectedRedaction

export const KNOWN_METADATA_RECORD_DISCARD_REASONS = Object.freeze({
  project_switched:
    'Desktop project membership is owned by the project registry, not session history.',
  file_read:
    'Read-before-edit identity is Core resume state and has no Desktop transcript presentation.',
  root_added:
    'Additional workspace roots are process-scoped CLI state and are not a Desktop transcript fact.',
  root_removed:
    'Additional workspace roots are process-scoped CLI state and are not a Desktop transcript fact.',
  root_cleared:
    'Additional workspace roots are process-scoped CLI state and are not a Desktop transcript fact.',
  compaction:
    'The compaction summary is internal model context rather than assistant-authored conversation content.',
  governance_event:
    'Opaque governance detail is diagnostic data and has no canonical Desktop diagnostics model.',
  reviewer_audit:
    'Auto-permission reviewer audit data is diagnostic metadata and has no Desktop transcript presentation.',
  background_session_linked:
    'Background session ownership is consumed by Core deletion and has no transcript presentation.',
  rewind_mark:
    'Code-only rewind preserves the transcript; its durable mark is checkpoint control metadata rather than conversation content.',
} satisfies Readonly<Record<KnownMetadataRecordDiscardType, string>>)

/**
 * Validates every pinned metadata SessionRecord and classifies whether Desktop
 * projects or intentionally discards it. A known record must never share the
 * append-only unknown-extension no-op path.
 */
export function parseKnownMetadataRecordDisposition(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): KnownMetadataRecordDisposition | null {
  const type = record.type
  if (!isKnownMetadataRecordType(type)) return null

  switch (type) {
    case 'project_switched':
      requireTimestamp(record.at, path, lineNumber, 'at')
      requireNonEmptyString(
        record.project_key,
        path,
        lineNumber,
        'project_key',
      )
      break
    case 'redacted_thinking': {
      const at = requireTimestamp(record.at, path, lineNumber, 'at')
      requireString(record.data, path, lineNumber, 'data')
      return {
        disposition: 'projected-redaction',
        recordType: 'redacted_thinking',
        at,
      }
    }
    case 'file_read': {
      requireTimestamp(record.at, path, lineNumber, 'at')
      requireNonEmptyString(record.tool_use_id, path, lineNumber, 'tool_use_id')
      requireNonEmptyString(record.path, path, lineNumber, 'path')
      requireNonNegativeInteger(record.size, path, lineNumber, 'size')
      const mtimeNs = requireNonNegativeNumber(
        record.mtime_ns,
        path,
        lineNumber,
        'mtime_ns',
      )
      if (!Number.isInteger(mtimeNs)) {
        throw sessionFileError(
          path,
          lineNumber,
          'mtime_ns must be a non-negative integer',
        )
      }
      const hashPrefix = requireNonEmptyString(
        record.hash_prefix,
        path,
        lineNumber,
        'hash_prefix',
      )
      if (!/^[a-f0-9]{32}$/u.test(hashPrefix)) {
        throw sessionFileError(
          path,
          lineNumber,
          'hash_prefix must be 32 lowercase hexadecimal characters',
        )
      }
      break
    }
    case 'root_added':
      requireTimestamp(record.at, path, lineNumber, 'at')
      requireNonEmptyString(record.path, path, lineNumber, 'path')
      validateOptionalBoolean(record, 'user_initiated', path, lineNumber)
      break
    case 'root_removed':
      requireTimestamp(record.at, path, lineNumber, 'at')
      requireNonEmptyString(record.path, path, lineNumber, 'path')
      break
    case 'root_cleared':
      requireTimestamp(record.at, path, lineNumber, 'at')
      break
    case 'compaction':
      requireTimestamp(record.at, path, lineNumber, 'at')
      requireString(record.summary, path, lineNumber, 'summary')
      requireNonNegativeInteger(
        record.summary_chars,
        path,
        lineNumber,
        'summary_chars',
      )
      validateOptionalNonNegativeInteger(
        record,
        'replaced_count',
        path,
        lineNumber,
      )
      validateOptionalNonNegativeInteger(
        record,
        'kept_count',
        path,
        lineNumber,
      )
      break
    case 'governance_event':
      requireTimestamp(record.at, path, lineNumber, 'at')
      requireNonEmptyString(record.kind, path, lineNumber, 'kind')
      requirePresentField(record, 'detail_json', path, lineNumber)
      break
    case 'reviewer_audit':
      validateReviewerAudit(record, path, lineNumber)
      break
    case 'background_session_linked':
      requireTimestamp(record.at, path, lineNumber, 'at')
      requireNonEmptyString(record.task_id, path, lineNumber, 'task_id')
      requireNonEmptyString(record.session_id, path, lineNumber, 'session_id')
      break
    case 'rewind_mark':
      requireTimestamp(record.at, path, lineNumber, 'at')
      requireNonEmptyString(
        record.checkpoint_id,
        path,
        lineNumber,
        'checkpoint_id',
      )
      requireNonEmptyString(record.mode, path, lineNumber, 'mode')
      break
  }

  return {
    disposition: 'validated-discard',
    recordType: type,
    reason: KNOWN_METADATA_RECORD_DISCARD_REASONS[type],
  }
}

function validateReviewerAudit(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): void {
  requireTimestamp(record.at, path, lineNumber, 'at')
  for (const field of [
    'request_id',
    'tool_call_id',
    'action_digest',
    'model',
    'prompt_version',
    'schema_version',
    'policy_version',
    'matrix_version',
    'status',
  ]) {
    requireNonEmptyString(record[field], path, lineNumber, field)
  }
  requireNonNegativeInteger(record.mode_epoch, path, lineNumber, 'mode_epoch')
  requireBoolean(
    record.transcript_truncated,
    path,
    lineNumber,
    'transcript_truncated',
  )
  requireNonNegativeInteger(record.latency_ms, path, lineNumber, 'latency_ms')
  validateNonNegativeIntegerArray(
    record.included_record_refs,
    'included_record_refs',
    path,
    lineNumber,
  )
  validateOptionalReviewerClassification(record, path, lineNumber)
  for (const field of ['matrix_cell', 'decision', 'failure_code']) {
    validateOptionalString(record, field, path, lineNumber)
  }
  for (const field of ['input_tokens', 'output_tokens']) {
    validateOptionalNonNegativeInteger(record, field, path, lineNumber)
  }
}

function validateOptionalReviewerClassification(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): void {
  if (!Object.hasOwn(record, 'classification')) return
  const classification = requireRecord(
    record.classification,
    path,
    lineNumber,
    'classification',
  )
  for (const field of ['intent_score', 'risk_score']) {
    const score = requireNonNegativeInteger(
      classification[field],
      path,
      lineNumber,
      `classification.${field}`,
    )
    if (score > 100) {
      throw sessionFileError(
        path,
        lineNumber,
        `classification.${field} must be at most 100`,
      )
    }
  }
  for (const field of [
    'intent_band',
    'intent_reason',
    'risk_band',
    'risk_reason',
  ]) {
    requireString(
      classification[field],
      path,
      lineNumber,
      `classification.${field}`,
    )
  }
}

function validateNonNegativeIntegerArray(
  value: unknown,
  field: string,
  path: string,
  lineNumber: number,
): void {
  if (!Array.isArray(value)) {
    throw sessionFileError(path, lineNumber, `${field} must be an array`)
  }
  value.forEach((entry, index) => {
    requireNonNegativeInteger(entry, path, lineNumber, `${field}[${index}]`)
  })
}

function validateOptionalBoolean(
  record: Record<string, unknown>,
  field: string,
  path: string,
  lineNumber: number,
): void {
  if (!Object.hasOwn(record, field)) return
  requireBoolean(record[field], path, lineNumber, field)
}

function validateOptionalString(
  record: Record<string, unknown>,
  field: string,
  path: string,
  lineNumber: number,
): void {
  if (!Object.hasOwn(record, field)) return
  requireString(record[field], path, lineNumber, field)
}

function isKnownMetadataRecordType(
  value: unknown,
): value is KnownMetadataRecordType {
  return value === 'redacted_thinking' || (
    typeof value === 'string' && Object.hasOwn(
      KNOWN_METADATA_RECORD_DISCARD_REASONS,
      value,
    )
  )
}

function validateOptionalNonNegativeInteger(
  record: Record<string, unknown>,
  field: string,
  path: string,
  lineNumber: number,
): void {
  if (!Object.hasOwn(record, field)) return
  requireNonNegativeInteger(record[field], path, lineNumber, field)
}

function requirePresentField(
  record: Record<string, unknown>,
  field: string,
  path: string,
  lineNumber: number,
): void {
  if (!Object.hasOwn(record, field)) {
    throw sessionFileError(path, lineNumber, `${field} is required`)
  }
}
