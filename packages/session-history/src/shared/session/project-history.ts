import { z } from 'zod'

const nonEmptyString = (message: string) =>
  z.string().refine((value) => value.trim().length > 0, { error: message })
const timestampString = (message: string) =>
  z.string().refine((value) => !Number.isNaN(Date.parse(value)), { error: message })

export const SessionHistoryItemSchema = z.strictObject({
  sessionId: nonEmptyString('CodeM CLI sessionId must be a non-empty string'),
  title: nonEmptyString('CodeM CLI history title must be a non-empty string'),
  cwd: nonEmptyString('CodeM CLI history cwd must be a non-empty string'),
  startedAt: timestampString('CodeM CLI history startedAt must be a timestamp'),
  updatedAt: timestampString('CodeM CLI history updatedAt must be a timestamp'),
  messageCount: z.number().int().nonnegative(),
})
export const SessionProjectHashSchema = z.string().regex(/^[0-9a-f]{16}$/u, {
  error: 'CodeM CLI session projectHash must be 16 lowercase hex characters',
})
export const SessionHistorySnapshotSchema = z.strictObject({
  projectHash: SessionProjectHashSchema,
  items: z.array(SessionHistoryItemSchema).readonly(),
  failureCount: z.number().int().nonnegative(),
})
const SessionProjectHistoryContinuationSchema = z.strictObject({
  cwd: nonEmptyString('CodeM CLI project history continuation cwd must be non-empty'),
  limit: z.number().int().min(1).max(100),
  revision: z.number().int().nonnegative(),
  updatedAt: timestampString('CodeM CLI project history continuation updatedAt must be a timestamp'),
  sessionId: nonEmptyString('CodeM CLI project history continuation sessionId must be non-empty'),
})
export const SessionProjectHistorySchema = z.strictObject({
  cwd: nonEmptyString('CodeM CLI project history cwd must be a non-empty string'),
  projectHash: SessionProjectHashSchema,
  items: z.array(SessionHistoryItemSchema).readonly(),
  failureCount: z.number().int().nonnegative(),
  next: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('end') }),
    z.strictObject({
      kind: z.literal('continue'),
      continuation: SessionProjectHistoryContinuationSchema,
    }),
  ]),
})
export const SessionProjectHistorySummarySchema = z.strictObject({
  cwd: nonEmptyString('CodeM CLI project history cwd must be a non-empty string'),
  updatedAt: timestampString(
    'CodeM CLI project history updatedAt must be a timestamp',
  ),
})
export const SessionProjectHistorySummariesSchema = z.array(
  SessionProjectHistorySummarySchema,
).readonly()
export const ListSessionProjectHistoryRequestSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      kind: z.literal('start'),
      cwd: nonEmptyString('CodeM CLI cwd must be a non-empty string'),
      limit: z.number().int().min(1).max(100),
    }),
    z.strictObject({
      kind: z.literal('continue'),
      continuation: SessionProjectHistoryContinuationSchema,
    }),
  ],
)
export const ReadSessionHistoryRequestSchema = z.strictObject({
  cwd: nonEmptyString('CodeM CLI cwd must be a non-empty string'),
  sessionId: nonEmptyString('CodeM CLI sessionId must be a non-empty string'),
})
export const ResolveSessionProjectHistoryRequestSchema = z.strictObject({
  sessions: z.array(ReadSessionHistoryRequestSchema).min(1).max(200).refine(
    (sessions) =>
      new Set(sessions.map((session) => `${session.cwd}\0${session.sessionId}`))
        .size === sessions.length,
    { error: 'CodeM CLI project history sessions must be unique' },
  ).readonly(),
})
export const SessionProjectHistoryResolutionSchema = z.strictObject({
  session: ReadSessionHistoryRequestSchema,
  item: SessionHistoryItemSchema.nullable(),
  failureCount: z.number().int().nonnegative(),
})
export const SessionProjectHistoryResolutionsSchema = z.array(
  SessionProjectHistoryResolutionSchema,
).readonly()

export type SessionHistoryItem = z.infer<typeof SessionHistoryItemSchema>
export type SessionHistorySnapshot = z.infer<typeof SessionHistorySnapshotSchema>
export type SessionProjectHistory = z.infer<typeof SessionProjectHistorySchema>
export type SessionProjectHistorySummary = z.infer<
  typeof SessionProjectHistorySummarySchema
>
export type SessionProjectHistorySummaries = z.infer<
  typeof SessionProjectHistorySummariesSchema
>
export type ListSessionProjectHistoryRequest = z.infer<
  typeof ListSessionProjectHistoryRequestSchema
>
export type ReadSessionHistoryRequest = z.infer<typeof ReadSessionHistoryRequestSchema>
export type ResolveSessionProjectHistoryRequest = z.infer<
  typeof ResolveSessionProjectHistoryRequestSchema
>
export type SessionProjectHistoryResolution = z.infer<
  typeof SessionProjectHistoryResolutionSchema
>

const MISSING_CODEM_SESSION_FILE_PREFIX = 'CodeM session file does not exist:'

export function missingCodeMSessionFileMessage(path: string): string {
  return `${MISSING_CODEM_SESSION_FILE_PREFIX} ${path}`
}

export function isMissingCodeMSessionHistoryError(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current = error
  while (current instanceof Error && !seen.has(current)) {
    if (current.message.includes(MISSING_CODEM_SESSION_FILE_PREFIX)) return true
    seen.add(current)
    current = current.cause
  }
  return false
}
