import {
  ConversationCheckpointFileSchema,
  ConversationCheckpointSkippedPathSchema,
  conversationFileDiffItemId,
} from "../../../session/index.ts"
import {
  parsePersistedFileDiff,
  persistedFileDiffSource,
} from "../file-diff.ts"
import {
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireString,
  requireTimestamp,
  summarize,
} from "../fields.ts"
import { sessionFileError } from "../jsonl.ts"
import { registerEngineTurnIndex, type MutableConversationTurn } from "./model.ts"
import type { TurnRecordContext } from "./records.ts"

export function applyFileDiff(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  const parsedDiff = parsePersistedFileDiff(record.diff)
  const source = persistedFileDiffSource(record.diff)
  if (!parsedDiff || !source) {
    throw sessionFileError(
      path,
      lineNumber,
      'diff does not match FileDiff schema',
    )
  }
  turn.items.push({
    id: conversationFileDiffItemId(turn.id, source, parsedDiff.path),
    kind: 'file-diff',
    runId: turn.id,
    source,
    diff: parsedDiff,
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  })
}

export function applyGovernanceSnapshot(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  turn.items.push({
    id: `${turn.id}:governance:${lineNumber}`,
    kind: 'activity',
    activityType: 'governance',
    text: '已记录治理状态',
    snapshot: summarize(record.snapshot_json),
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  })
}

export function applyCheckpoint(
  turn: MutableConversationTurn,
  record: Record<string, unknown>,
  { path, lineNumber }: TurnRecordContext,
): void {
  registerEngineTurnIndex(
    turn,
    requireNonNegativeInteger(record.turn_index, path, lineNumber, 'turn_index'),
    lineNumber,
  )
  const checkpointId = requireNonEmptyString(record.id, path, lineNumber, 'id')
  const label = requireString(record.label, path, lineNumber, 'label')
  const files = ConversationCheckpointFileSchema.array()
    .readonly()
    .safeParse(record.files)
  if (!files.success) {
    throw sessionFileError(
      path,
      lineNumber,
      `checkpoint files are invalid: ${files.error.message}`,
    )
  }
  const skippedPaths = ConversationCheckpointSkippedPathSchema.array()
    .readonly()
    .safeParse(record.skipped_paths ?? [])
  if (!skippedPaths.success) {
    throw sessionFileError(
      path,
      lineNumber,
      `checkpoint skipped_paths are invalid: ${skippedPaths.error.message}`,
    )
  }
  turn.items.push({
    id: `${turn.id}:checkpoint:${checkpointId}`,
    kind: 'activity',
    activityType: 'checkpoint',
    text: label ? `已创建检查点：${label}` : '已创建检查点',
    checkpointId,
    label,
    files: files.data,
    skippedPaths: skippedPaths.data,
    at: requireTimestamp(record.created_at, path, lineNumber, 'created_at'),
  })
}
