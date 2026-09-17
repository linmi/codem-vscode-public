import { z } from 'zod'

export const DiagnosticFailureSchema = z.strictObject({
  code: identityString('Diagnostic failure code must be a non-empty identity'),
  operation: identityString(
    'Diagnostic failure operation must be a non-empty identity',
  ),
  retryable: z.boolean(),
  diagnosticId: identityString(
    'Diagnostic failure diagnosticId must be a non-empty identity',
  ),
})

export type DiagnosticFailure = Readonly<
  z.infer<typeof DiagnosticFailureSchema>
>

export type DiagnosticResult<
  Value,
  Failure extends DiagnosticFailure = DiagnosticFailure,
> =
  | { readonly status: 'succeeded'; readonly value: Value }
  | { readonly status: 'failed'; readonly failure: Failure }

export function diagnosticResultSchema<
  ValueSchema extends z.ZodType,
  FailureSchema extends z.ZodType<DiagnosticFailure>,
>(
  valueSchema: ValueSchema,
  failureSchema: FailureSchema,
) {
  return z.discriminatedUnion('status', [
    z.strictObject({
      status: z.literal('succeeded'),
      value: valueSchema,
    }),
    z.strictObject({
      status: z.literal('failed'),
      failure: failureSchema,
    }),
  ])
}

export const FailurePresentationSchema = z.strictObject({
  title: nonBlankString('Failure presentation title must be non-blank'),
  message: nonBlankString('Failure presentation message must be non-blank'),
  retryable: z.boolean(),
  diagnosticId: identityString(
    'Failure presentation diagnosticId must be a non-empty identity',
  ),
})

export type FailurePresentation = Readonly<
  z.infer<typeof FailurePresentationSchema>
>

let fallbackDiagnosticSequence = 0

export function createDiagnosticId(): string {
  fallbackDiagnosticSequence += 1
  return [
    'diagnostic',
    Date.now().toString(36),
    fallbackDiagnosticSequence.toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join('-')
}

export function nonBlankString(message: string): z.ZodString {
  return z.string().refine((value) => value.trim().length > 0, { error: message })
}

export function identityString(message: string): z.ZodString {
  return z.string().refine(
    (value) => value.trim().length > 0 && value.trim() === value,
    { error: message },
  )
}

export function absolutePathString(message: string): z.ZodString {
  return nonBlankString(message).refine(
    (value) =>
      value.startsWith('/') ||
      /^[A-Za-z]:[\\/]/u.test(value) ||
      value.startsWith('\\\\'),
    { error: message },
  )
}

export function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null
  ) {
    return false
  }
  const leftIsArray = Array.isArray(left)
  const rightIsArray = Array.isArray(right)
  if (leftIsArray !== rightIsArray) return false
  if (leftIsArray && rightIsArray) {
    return left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.hasOwn(rightRecord, key) &&
    jsonValuesEqual(leftRecord[key], rightRecord[key])
  )
}
