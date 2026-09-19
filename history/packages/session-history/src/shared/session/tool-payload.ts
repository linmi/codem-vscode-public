import { z } from 'zod'

export const DurableExternalContentSchema = z.strictObject({
  kind: z.literal('durable'),
  path: z.string().regex(/^blobs\/[A-Za-z0-9._-]+$/u),
  byteSize: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  encoding: z.literal('utf-8'),
  truncatedInlineBytes: z.number().int().nonnegative(),
}).readonly()

export type DurableExternalContent = z.infer<
  typeof DurableExternalContentSchema
>

export const TOOL_PAYLOAD_PREVIEW_LIMIT = 4_000

export const ToolPayloadSchema = z.strictObject({
  value: z.json(),
  preview: z.string(),
  previewTruncated: z.boolean(),
  externalContent: DurableExternalContentSchema.nullable().optional(),
}).superRefine((payload, context) => {
  const expected = payloadPreview(payload.value)
  if (
    payload.preview !== expected.preview ||
    payload.previewTruncated !== expected.previewTruncated
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Tool payload preview metadata does not match its complete value',
    })
  }
})

export type ToolPayload = z.infer<typeof ToolPayloadSchema>

export function createToolPayload(value: unknown): ToolPayload {
  const parsedValue = z.json().parse(value)
  return {
    value: parsedValue,
    ...payloadPreview(parsedValue),
  }
}

export function createExternalToolPayload(
  value: unknown,
  externalContent: DurableExternalContent,
): ToolPayload {
  return { ...createToolPayload(value), externalContent }
}

function payloadPreview(value: z.infer<ReturnType<typeof z.json>>): {
  readonly preview: string
  readonly previewTruncated: boolean
} {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const previewTruncated = text.length > TOOL_PAYLOAD_PREVIEW_LIMIT
  return {
    preview: previewTruncated
      ? `${text.slice(0, TOOL_PAYLOAD_PREVIEW_LIMIT)}\n…`
      : text,
    previewTruncated,
  }
}

export function toolPayloadText(payload: ToolPayload): string {
  return typeof payload.value === 'string'
    ? payload.value
    : JSON.stringify(payload.value)
}

export function appendToolPayloadText(
  current: ToolPayload | null,
  delta: string,
): ToolPayload {
  let currentText = ''
  if (current !== null) {
    if (typeof current.value !== 'string') {
      throw new Error('Cannot append streamed tool output to a non-text payload')
    }
    currentText = current.value
  }
  return createToolPayload(`${currentText}${delta}`)
}
