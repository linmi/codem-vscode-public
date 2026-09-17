import { z } from 'zod'

export const SteerModeSchema = z.enum(['soft', 'interrupt'], {
  error: (issue) => `Unsupported steer mode: ${String(issue.input)}`,
})
export const ConversationSteerResultSchema = z.enum([
  'pending',
  'accepted',
  'unknown',
])
export const SteerSessionEventSchemas = [
  z.strictObject({
    type: z.literal('steer-pending'),
    requestId: z.string().min(1, 'CodeM steer requestId must be non-empty'),
    text: z.string(),
    mode: SteerModeSchema,
  }),
  z.strictObject({
    type: z.literal('steer-accepted'),
    requestId: z.string().min(1, 'CodeM steer requestId must be non-empty'),
    text: z.string(),
    mode: SteerModeSchema,
  }),
  z.strictObject({
    type: z.literal('steer-unconfirmed'),
    requestId: z.string().min(1, 'CodeM steer requestId must be non-empty'),
    text: z.string(),
    mode: SteerModeSchema,
  }),
] as const

export type SteerMode = z.infer<typeof SteerModeSchema>
export type ConversationSteerResult = z.infer<
  typeof ConversationSteerResultSchema
>
