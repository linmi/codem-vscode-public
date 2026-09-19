import { z } from 'zod'
import { DiagnosticFailureSchema } from "../schema/index.ts"

const nonEmptyString = (message: string) =>
  z.string().refine((value) => value.trim().length > 0, { error: message })

export const PlanDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('approve') }),
  z.strictObject({ kind: z.literal('reject'), feedback: z.string() }),
])
export const PlanReadyRequestSchema = z.strictObject({
  requestId: nonEmptyString('CodeM plan requestId must be non-empty'),
  plan: nonEmptyString('CodeM plan must be non-empty'),
})
export const PlanResponseRequestSchema = z.strictObject({
  runId: nonEmptyString('CodeM CLI runId must be a non-empty string'),
  requestId: nonEmptyString('CodeM CLI requestId must be a non-empty string'),
  decision: PlanDecisionSchema,
})
export const BackgroundCancelResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    taskId: nonEmptyString('CodeM background taskId must be non-empty'),
    status: z.literal('cancelled'),
    workerShutdown: z.boolean(),
  }),
  z.strictObject({
    taskId: nonEmptyString('CodeM background taskId must be non-empty'),
    status: z.literal('not_found'),
  }),
  z.strictObject({
    taskId: nonEmptyString('CodeM background taskId must be non-empty'),
    status: z.literal('noop'),
  }),
  z.strictObject({
    taskId: nonEmptyString('CodeM background taskId must be non-empty'),
    status: z.literal('error'),
    failure: DiagnosticFailureSchema.extend({
      code: z.literal('BACKGROUND_CANCEL_FAILED'),
      operation: z.literal('cancel-background-task'),
      retryable: z.literal(true),
    }),
  }),
])
export const CancelBackgroundTaskRequestSchema = z.strictObject({
  runId: nonEmptyString('CodeM CLI runId must be a non-empty string'),
  taskId: nonEmptyString('CodeM background taskId must be non-empty'),
})

export const PlanModeDecisionSchema = z.enum(['approve', 'reject'], {
  error: (issue) => `Unsupported plan mode decision: ${String(issue.input)}`,
})
export const PlanModeResponseRequestSchema = z.strictObject({
  runId: nonEmptyString('CodeM CLI runId must be a non-empty string'),
  requestId: nonEmptyString('CodeM CLI requestId must be a non-empty string'),
  decision: PlanModeDecisionSchema,
})

export const UserQuestionOptionSchema = z.strictObject({
  label: z.string(),
  description: z.string(),
  preview: z.string().nullable(),
})
export const UserQuestionSchema = z.strictObject({
  id: nonEmptyString('CodeM CLI question id must be a non-empty string'),
  header: z.string(),
  question: nonEmptyString('CodeM CLI question must be a non-empty string'),
  allowsMultipleSelection: z.boolean(),
  options: z.array(UserQuestionOptionSchema).readonly(),
})
export const UserQuestionRequestSchema = z.strictObject({
  requestId: nonEmptyString(
    'CodeM CLI question requestId must be a non-empty string',
  ),
  questions: z.array(UserQuestionSchema).readonly(),
})
export const UserQuestionAnswerSchema = z.strictObject({
  question: nonEmptyString('CodeM CLI question must be a non-empty string'),
  selected: z.array(z.string()),
  freeText: z.string().nullable(),
})
export const UserQuestionReplySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('answered'),
    answers: z.array(UserQuestionAnswerSchema).readonly(),
  }),
  z.strictObject({ status: z.literal('cancelled') }),
])
export const UserQuestionResponseRequestSchema = z.strictObject({
  runId: nonEmptyString('CodeM CLI runId must be a non-empty string'),
  requestId: nonEmptyString('CodeM CLI requestId must be a non-empty string'),
  reply: UserQuestionReplySchema,
})

export type PlanDecision = z.infer<typeof PlanDecisionSchema>
export type PlanReadyRequest = z.infer<typeof PlanReadyRequestSchema>
export type PlanResponseRequest = z.infer<typeof PlanResponseRequestSchema>
export type BackgroundCancelResult = z.infer<typeof BackgroundCancelResultSchema>
export type CancelBackgroundTaskRequest = z.infer<
  typeof CancelBackgroundTaskRequestSchema
>
export type PlanModeDecision = z.infer<typeof PlanModeDecisionSchema>
export type PlanModeResponseRequest = z.infer<
  typeof PlanModeResponseRequestSchema
>
export type UserQuestionOption = z.infer<typeof UserQuestionOptionSchema>
export type UserQuestion = z.infer<typeof UserQuestionSchema>
export type UserQuestionRequest = z.infer<typeof UserQuestionRequestSchema>
export type UserQuestionAnswer = z.infer<typeof UserQuestionAnswerSchema>
export type UserQuestionReply = z.infer<typeof UserQuestionReplySchema>
export type UserQuestionResponseRequest = z.infer<
  typeof UserQuestionResponseRequestSchema
>
