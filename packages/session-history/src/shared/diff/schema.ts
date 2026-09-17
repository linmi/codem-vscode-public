import { z } from 'zod'

export const FileChangeTypeSchema = z.enum([
  'new',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'type-changed',
  'unmerged',
])

export const FileDiffLineKindSchema = z.enum([
  'context',
  'insert',
  'delete',
])

export const FileDiffLineSchema = z.strictObject({
  kind: FileDiffLineKindSchema,
  oldLine: z.number().int().positive().nullable(),
  newLine: z.number().int().positive().nullable(),
  text: z.string(),
}).superRefine((line, context) => {
  const valid =
    (line.kind === 'insert' && line.oldLine === null && line.newLine !== null) ||
    (line.kind === 'delete' && line.oldLine !== null && line.newLine === null) ||
    (line.kind === 'context' && line.oldLine !== null && line.newLine !== null)
  if (!valid) {
    context.addIssue({
      code: 'custom',
      message: `File diff line numbers do not match kind ${line.kind}`,
    })
  }
}).readonly()

export const FileDiffHunkSchema = z.strictObject({
  oldStart: z.number().int().nonnegative(),
  oldCount: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  lines: z.array(FileDiffLineSchema).readonly(),
}).superRefine((hunk, context) => {
  if (
    (hunk.oldCount === 0 ? hunk.oldStart !== 0 : hunk.oldStart < 1) ||
    (hunk.newCount === 0 ? hunk.newStart !== 0 : hunk.newStart < 1)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'File diff hunk has invalid start/count pairs',
    })
  }
  let oldLine = hunk.oldStart
  let newLine = hunk.newStart
  let oldCount = 0
  let newCount = 0
  for (const line of hunk.lines) {
    if (line.oldLine !== null) {
      if (line.oldLine !== oldLine) {
        context.addIssue({
          code: 'custom',
          message: 'File diff hunk old line numbers are not contiguous',
        })
        break
      }
      oldLine += 1
      oldCount += 1
    }
    if (line.newLine !== null) {
      if (line.newLine !== newLine) {
        context.addIssue({
          code: 'custom',
          message: 'File diff hunk new line numbers are not contiguous',
        })
        break
      }
      newLine += 1
      newCount += 1
    }
  }
  if (oldCount !== hunk.oldCount || newCount !== hunk.newCount) {
    context.addIssue({
      code: 'custom',
      message: 'File diff hunk line counts do not match its header',
    })
  }
}).readonly()

export const FileDiffStatsSchema = z.strictObject({
  linesAdded: z.number().int().nonnegative(),
  linesRemoved: z.number().int().nonnegative(),
}).readonly()

const FileDiffCompletePreviewSchema = z.strictObject({
  kind: z.literal('complete'),
  hunks: z.array(FileDiffHunkSchema).readonly(),
}).readonly()

const FileDiffPartialPreviewSchema = z.strictObject({
  kind: z.literal('partial'),
  hunks: z.array(FileDiffHunkSchema).min(
    1,
    'Partial file diff preview must contain at least one hunk',
  ).readonly(),
}).readonly()

const FileDiffRawPartialPreviewSchema = z.strictObject({
  kind: z.literal('raw-partial'),
  text: z.string().refine((text) => text.trim().length > 0, {
    error: 'Raw partial file diff preview must be non-empty',
  }),
}).readonly()

const FileDiffPreviewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('binary') }).readonly(),
  FileDiffCompletePreviewSchema,
  FileDiffPartialPreviewSchema,
  FileDiffRawPartialPreviewSchema,
  z.strictObject({ kind: z.literal('omitted') }).readonly(),
])

export const FileDiffSchema = z.strictObject({
  path: z.string().min(1, 'File diff path must be non-empty'),
  changeType: FileChangeTypeSchema,
  stats: FileDiffStatsSchema,
  preview: FileDiffPreviewSchema,
}).superRefine((diff, context) => {
  if (
    diff.preview.kind !== 'complete' &&
    diff.preview.kind !== 'partial'
  ) return

  const linesAdded = diff.preview.hunks.reduce(
    (total, hunk) =>
      total + hunk.lines.filter((line) => line.kind === 'insert').length,
    0,
  )
  const linesRemoved = diff.preview.hunks.reduce(
    (total, hunk) =>
      total + hunk.lines.filter((line) => line.kind === 'delete').length,
    0,
  )

  if (diff.preview.kind === 'complete' && (
    linesAdded !== diff.stats.linesAdded ||
    linesRemoved !== diff.stats.linesRemoved
  )) {
    context.addIssue({
      code: 'custom',
      message: 'File diff stats do not match its complete preview hunks',
    })
  }
  if (diff.preview.kind === 'partial' && (
    linesAdded > diff.stats.linesAdded ||
    linesRemoved > diff.stats.linesRemoved
  )) {
    context.addIssue({
      code: 'custom',
      message: 'File diff partial preview exceeds its total stats',
    })
  }
}).readonly()

export type FileChangeType = z.infer<typeof FileChangeTypeSchema>
export type FileDiffLineKind = z.infer<typeof FileDiffLineKindSchema>
export type FileDiffLine = z.infer<typeof FileDiffLineSchema>
export type FileDiffHunk = z.infer<typeof FileDiffHunkSchema>
export type FileDiffStats = z.infer<typeof FileDiffStatsSchema>
export type FileDiffPreview = z.infer<typeof FileDiffPreviewSchema>
export type FileDiff = z.infer<typeof FileDiffSchema>
