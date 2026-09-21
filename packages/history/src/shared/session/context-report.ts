import { z } from 'zod'

const nonEmptyString = (message: string) => z.string().trim().min(1, message)
const tokenCount = (message: string) => z.number().int().nonnegative(message)

export const ContextReportItemSchema = z.strictObject({
  label: nonEmptyString('Context report item label must be non-empty'),
  tokens: tokenCount('Context report item tokens must be non-negative'),
  detail: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  layer: nonEmptyString('Context report item layer must be non-empty').nullable(),
  sizePolicy: nonEmptyString(
    'Context report item sizePolicy must be non-empty',
  ).nullable(),
}).readonly()

export const ContextReportGroupSchema = z.strictObject({
  label: nonEmptyString('Context report group label must be non-empty'),
  tokens: tokenCount('Context report group tokens must be non-negative'),
  items: z.array(ContextReportItemSchema).readonly(),
}).readonly()

export const ContextReportToolResultsSchema = z.strictObject({
  largestToolResultBytes: z.number().int().nonnegative().nullable(),
  largestToolResultToolName: z.string().nullable(),
  largestToolResultGuardStatus: z.string().nullable(),
  largestToolResultGuardReason: z.string().nullable(),
  toolResultOver32kbCount: tokenCount(
    'Context report over-32kb count must be non-negative',
  ),
  toolResultOver64kbCount: tokenCount(
    'Context report over-64kb count must be non-negative',
  ),
  toolResultBlockedCount: tokenCount(
    'Context report blocked count must be non-negative',
  ),
  toolResultTruncatedCount: tokenCount(
    'Context report truncated count must be non-negative',
  ),
  globalBackstopAppliedCount: tokenCount(
    'Context report global backstop count must be non-negative',
  ),
  contextBudgetAppliedCount: tokenCount(
    'Context report context-budget count must be non-negative',
  ),
}).readonly()

export const ContextReportSchema = z.strictObject({
  budgetTokens: tokenCount('Context report budgetTokens must be non-negative'),
  maxResponseTokens: tokenCount(
    'Context report maxResponseTokens must be non-negative',
  ),
  groups: z.array(ContextReportGroupSchema).readonly(),
  toolResults: ContextReportToolResultsSchema,
}).readonly()

export type ContextReport = z.infer<typeof ContextReportSchema>

export function contextReportText(report: ContextReport): string {
  const used = report.groups.reduce((total, group) => total + group.tokens, 0)
  return `上下文 ${formatTokens(used)} / ${formatTokens(report.budgetTokens)} tokens`
}

function formatTokens(tokens: number): string {
  return new Intl.NumberFormat('en-US').format(tokens)
}
