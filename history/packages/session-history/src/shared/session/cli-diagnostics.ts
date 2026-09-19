import { z } from 'zod'

const nonEmptyString = (message: string) => z.string().refine(
  (value) => value.trim().length > 0,
  message,
)

export const RuntimeWarningSchema = z.strictObject({
  kind: nonEmptyString('CodeM CLI warning kind must be non-empty'),
  message: nonEmptyString('CodeM CLI warning message must be non-empty'),
})

export type RuntimeWarning = z.infer<typeof RuntimeWarningSchema>

export const ToolGuardReportSchema = z.strictObject({
  toolName: nonEmptyString('CodeM ToolGuard toolName must be non-empty'),
  toolCallId: nonEmptyString('CodeM ToolGuard toolCallId must be non-empty'),
  status: nonEmptyString('CodeM ToolGuard status must be non-empty'),
  reason: nonEmptyString('CodeM ToolGuard reason must be non-empty'),
  rawResultBytes: z.number().int().nonnegative().nullable(),
  returnedResultBytes: z.number().int().nonnegative(),
  formattedCapBytes: z.number().int().nonnegative().nullable(),
  globalBackstopApplied: z.boolean(),
  suggestion: z.string().nullable(),
})

export type ToolGuardReport = z.infer<typeof ToolGuardReportSchema>

export function toolGuardText(report: ToolGuardReport): string {
  const effect = report.status === 'pass' ? '通过' : report.status
  return `${report.toolName} · ${effect} · ${report.reason}`
}
