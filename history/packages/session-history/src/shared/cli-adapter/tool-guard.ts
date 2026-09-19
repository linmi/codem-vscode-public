import type { ToolGuardReport } from "../session/index.ts"

const FIELDS = [
  'tool_name',
  'tool_call_id',
  'status',
  'reason',
  'raw_result_bytes',
  'returned_result_bytes',
  'formatted_cap_bytes',
  'global_backstop_applied',
  'suggestion',
] as const

export function parseToolGuardReport(
  value: unknown,
  fail: (message: string) => Error = (message) => new Error(message),
): ToolGuardReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('must be an object')
  }
  const report = value as Record<string, unknown>
  const missing = FIELDS.filter((field) => !Object.hasOwn(report, field))
  if (missing.length > 0) {
    throw fail(`is missing required fields: ${missing.join(', ')}`)
  }
  const allowed = new Set<string>(FIELDS)
  const unsupported = Object.keys(report).filter((field) => !allowed.has(field))
  if (unsupported.length > 0) {
    throw fail(`has unsupported fields: ${unsupported.join(', ')}`)
  }
  const nonBlank = (
    field: 'tool_name' | 'tool_call_id' | 'status' | 'reason',
  ): string => {
    const fieldValue = report[field]
    if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
      throw fail(`.${field} must be a non-empty string`)
    }
    return fieldValue
  }
  const nullableNonNegativeInteger = (
    field: 'raw_result_bytes' | 'formatted_cap_bytes',
  ): number | null => {
    const fieldValue = report[field]
    if (fieldValue === null) return null
    if (!Number.isSafeInteger(fieldValue) || (fieldValue as number) < 0) {
      throw fail(`.${field} must be a non-negative safe integer or null`)
    }
    return fieldValue as number
  }
  const returnedResultBytes = report.returned_result_bytes
  if (!Number.isSafeInteger(returnedResultBytes) || (returnedResultBytes as number) < 0) {
    throw fail('.returned_result_bytes must be a non-negative safe integer')
  }
  if (typeof report.global_backstop_applied !== 'boolean') {
    throw fail('.global_backstop_applied must be a boolean')
  }
  if (report.suggestion !== null && typeof report.suggestion !== 'string') {
    throw fail('.suggestion must be a string or null')
  }
  return {
    toolName: nonBlank('tool_name'),
    toolCallId: nonBlank('tool_call_id'),
    status: nonBlank('status'),
    reason: nonBlank('reason'),
    rawResultBytes: nullableNonNegativeInteger('raw_result_bytes'),
    returnedResultBytes: returnedResultBytes as number,
    formattedCapBytes: nullableNonNegativeInteger('formatted_cap_bytes'),
    globalBackstopApplied: report.global_backstop_applied,
    suggestion: report.suggestion,
  }
}
