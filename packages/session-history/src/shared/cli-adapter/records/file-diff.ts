import { z } from 'zod'
import {
  FileChangeTypeSchema,
  FileDiffSchema,
  type FileDiff,
} from "../../diff/index.ts"
import type { FileDiffSource } from "../../session/index.ts"

const PersistedFileDiffLineSchema = z.strictObject({
  kind: z.enum(['context', 'insert', 'delete']),
  old_line: z.number().int().positive().nullable(),
  new_line: z.number().int().positive().nullable(),
  text: z.string(),
}).readonly()

const PersistedFileDiffHunkSchema = z.strictObject({
  old_start: z.number().int().nonnegative(),
  old_count: z.number().int().nonnegative(),
  new_start: z.number().int().nonnegative(),
  new_count: z.number().int().nonnegative(),
  lines: z.array(PersistedFileDiffLineSchema).readonly(),
}).readonly()

const PersistedFileDiffSchema = z.strictObject({
  tool_call_id: z.string().min(1),
  background_task_id: z.string().min(1).optional(),
  path: z.string().min(1),
  change_type: FileChangeTypeSchema,
  is_binary: z.boolean(),
  truncated: z.boolean(),
  stats: z.strictObject({
    lines_added: z.number().int().nonnegative(),
    lines_removed: z.number().int().nonnegative(),
  }).readonly(),
  hunks: z.array(PersistedFileDiffHunkSchema).readonly(),
  raw_unified: z.string().nullable(),
}).superRefine((diff, context) => {
  if (diff.is_binary && diff.hunks.length > 0) {
    context.addIssue({
      code: 'custom',
      message: 'Binary session file diff cannot contain text hunks',
    })
  }
}).readonly()

export function parsePersistedFileDiff(value: unknown): FileDiff | null {
  const persisted = PersistedFileDiffSchema.safeParse(value)
  if (!persisted.success) return null

  const {
    is_binary: isBinary,
    truncated,
    raw_unified: rawUnified,
    tool_call_id: _toolCallId,
    background_task_id: _backgroundTaskId,
    change_type: changeType,
    stats,
    hunks: persistedHunks,
    path,
  } = persisted.data
  const hunks = persistedHunks.map((hunk) => ({
    oldStart: hunk.old_start,
    oldCount: hunk.old_count,
    newStart: hunk.new_start,
    newCount: hunk.new_count,
    lines: hunk.lines.map((line) => ({
      kind: line.kind,
      oldLine: line.old_line,
      newLine: line.new_line,
      text: line.text,
    })),
  }))
  const projected = FileDiffSchema.safeParse({
    path,
    changeType,
    stats: {
      linesAdded: stats.lines_added,
      linesRemoved: stats.lines_removed,
    },
    preview: isBinary
      ? { kind: 'binary' }
      : !truncated
        ? { kind: 'complete', hunks }
        : hunks.length > 0
          ? { kind: 'partial', hunks }
          : rawUnified?.trim()
            ? { kind: 'raw-partial', text: rawUnified }
          : { kind: 'omitted' },
  })
  return projected.success ? projected.data : null
}

export function persistedFileDiffSource(value: unknown): FileDiffSource | null {
  const persisted = PersistedFileDiffSchema.safeParse(value)
  if (!persisted.success) return null
  const { background_task_id: backgroundTaskId, tool_call_id: toolCallId } = persisted.data
  return backgroundTaskId
    ? { kind: 'background-tool', backgroundTaskId, toolCallId }
    : { kind: 'tool', toolCallId }
}
