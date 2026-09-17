import { sessionFileError } from "./jsonl.ts"

const SUMMARY_LIMIT = 4_000
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u

export function requireString(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): string {
  if (typeof value !== 'string') {
    throw sessionFileError(path, lineNumber, `${field} must be a string`)
  }
  return value
}

export function requireNonEmptyString(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw sessionFileError(path, lineNumber, `${field} must be a non-empty string`)
  }
  return value
}

export function nullableString(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): string | null {
  if (value === null || value === undefined) return null
  return requireString(value, path, lineNumber, field)
}

export function requireBoolean(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw sessionFileError(path, lineNumber, `${field} must be a boolean`)
  }
  return value
}

export function requireRecord(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw sessionFileError(path, lineNumber, `${field} must be an object`)
  }
  return value as Record<string, unknown>
}

export function requireNonNegativeInteger(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw sessionFileError(
      path,
      lineNumber,
      `${field} must be a non-negative integer`,
    )
  }
  return value as number
}

export function requireNonNegativeNumber(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw sessionFileError(
      path,
      lineNumber,
      `${field} must be a non-negative number`,
    )
  }
  return value
}

export function requireNullableNumber(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw sessionFileError(
      path,
      lineNumber,
      `${field} must be a non-negative number or null`,
    )
  }
  return value
}

export function nullableInteger(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw sessionFileError(
      path,
      lineNumber,
      `${field} must be an integer or null`,
    )
  }
  return value
}

export function requireTimestamp(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): string {
  const timestamp = requireNonEmptyString(value, path, lineNumber, field)
  if (!ISO_TIMESTAMP.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw sessionFileError(path, lineNumber, `${field} must be an ISO timestamp`)
  }
  return timestamp
}

export function summarize(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > SUMMARY_LIMIT
    ? `${text.slice(0, SUMMARY_LIMIT)}\n…`
    : text
}
