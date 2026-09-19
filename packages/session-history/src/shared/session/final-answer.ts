import { z } from 'zod'

export const FinalAnswerStatusSchema = z.enum([
  'complete',
  'partial',
  'blocked',
])
export const FinalAnswerKindSchema = z.enum(['chat', 'task'])

export const FinalAnswerArtifactSchema = z.strictObject({
  kind: z.enum(['file', 'image', 'chart', 'url']),
  title: z.string(),
  source: z.string().nullable().optional(),
  uri: z.string().nullable().optional(),
  path: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
  alt: z.string().nullable().optional(),
  mime: z.string().nullable().optional(),
  spec: z.json().nullable().optional(),
})

export const FinalAnswerStructuredSchema = z.strictObject({
  status: FinalAnswerStatusSchema,
  kind: FinalAnswerKindSchema,
  summary: nonEmptyString('Final answer summary must be non-empty'),
  artifacts: z.array(FinalAnswerArtifactSchema).readonly(),
})

export const AssistantDeliverySchema = z.union([
  z.strictObject({
    synthetic: z.literal(false),
    structured: z.null(),
  }),
  z.strictObject({
    synthetic: z.literal(true),
    structured: FinalAnswerStructuredSchema,
  }),
])

export type FinalAnswerArtifact = z.infer<typeof FinalAnswerArtifactSchema>
export type FinalAnswerStructured = z.infer<typeof FinalAnswerStructuredSchema>
export type AssistantDelivery = z.infer<typeof AssistantDeliverySchema>

function nonEmptyString(message: string): z.ZodString {
  return z.string().refine((value) => value.trim().length > 0, { error: message })
}
