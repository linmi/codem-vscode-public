import { requireNonNegativeInteger } from "./fields.ts"
import { sessionFileError } from "./jsonl.ts"

export type RecordSequenceMode =
  | 'undetermined'
  | 'legacy-optional'
  | 'legacy-prefix'
  | 'sequenced'

export interface RecordSequenceState {
  readonly mode: RecordSequenceMode
  readonly last: number | null
}

export function validateRecordSequence(
  record: Record<string, unknown>,
  state: RecordSequenceState,
  path: string,
  lineNumber: number,
): { readonly record: Record<string, unknown>; readonly state: RecordSequenceState } {
  const schemaVersion = record.type === 'header'
    ? requireNonNegativeInteger(record.schema_version, path, lineNumber, 'schema_version')
    : null
  const raw = record.record_seq
  let mode = state.mode
  if (record.type === 'header' && mode === 'undetermined') {
    // Two released Core histories used schema 11: the older format had no
    // sequence identity, while the durable App Server contract added it. Core
    // can also resume an older file by starting at its next physical record.
    if (schemaVersion !== null && schemaVersion < 11) {
      mode = 'legacy-optional'
    } else {
      mode = (schemaVersion !== null && schemaVersion >= 12) || raw !== undefined
        ? 'sequenced'
        : 'legacy-prefix'
    }
  } else if (mode === 'undetermined' && raw !== undefined) {
    mode = 'sequenced'
  }
  let last = state.last
  if (raw === undefined) {
    if (mode === 'sequenced') {
      throw sessionFileError(path, lineNumber, 'sequenced session record is missing record_seq')
    }
  } else {
    const sequence = requireNonNegativeInteger(raw, path, lineNumber, 'record_seq')
    if (sequence === 0) {
      throw sessionFileError(path, lineNumber, 'record_seq must be positive')
    }
    if (mode === 'legacy-prefix') {
      if (sequence !== lineNumber) {
        throw sessionFileError(
          path,
          lineNumber,
          `record_seq ${sequence} does not follow legacy prefix ending at ${lineNumber - 1}`,
        )
      }
      mode = 'sequenced'
    }
    if (last !== null && sequence !== last + 1) {
      throw sessionFileError(path, lineNumber, `record_seq ${sequence} does not follow ${last}`)
    }
    if (last === null && schemaVersion !== null && schemaVersion >= 11 && sequence !== 1) {
      throw sessionFileError(
        path,
        lineNumber,
        `schema 11 record sequence must start at 1, received ${sequence}`,
      )
    }
    last = sequence
  }
  if (raw === undefined) return { record, state: { mode, last } }
  const { record_seq: _recordSeq, ...payload } = record
  return { record: payload, state: { mode, last } }
}
