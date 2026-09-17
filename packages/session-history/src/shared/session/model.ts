import { z } from 'zod'
import {
  DiagnosticFailureSchema,
  FailurePresentationSchema,
} from "../schema/index.ts"
import { FileDiffSchema } from "../diff/index.ts"
import {
  ConversationAttachmentListSchema,
  SessionImageAttachmentSchema,
} from "./attachment.ts"
import { TodoItemSchema, TodoSnapshotSchema, TodoStatusSchema } from "./todo.ts"
import {
  SessionHistoryItemSchema,
  SessionProjectHashSchema,
} from "./project-history.ts"
import {
  ConversationSteerResultSchema,
  SteerModeSchema,
} from "./steer.ts"
import {
  PermissionRequestSchema,
  PermissionDecisionSchema,
} from "./permission.ts"
import {
  PlanModeDecisionSchema,
  PlanDecisionSchema,
  PlanReadyRequestSchema,
  UserQuestionReplySchema,
  UserQuestionRequestSchema,
} from "./interaction-contracts.ts"
import { AssistantDeliverySchema } from "./final-answer.ts"
import { ToolPayloadSchema } from "./tool-payload.ts"
import { ContextReportSchema } from "./context-report.ts"
import { RuntimeWarningSchema, ToolGuardReportSchema } from "./cli-diagnostics.ts"
import { REDACTED_REASONING_TEXT } from "./reasoning.ts"
export const FileDiffSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('tool'),
    toolCallId: z.string().min(1, 'Agent file diff toolCallId must be non-empty'),
  }).readonly(),
  z.strictObject({
    kind: z.literal('background-tool'),
    backgroundTaskId: z.string().min(
      1,
      'Background file diff backgroundTaskId must be non-empty',
    ),
    toolCallId: z.string().min(
      1,
      'Background file diff toolCallId must be non-empty',
    ),
  }).readonly(),
  z.strictObject({
    kind: z.literal('checkpoint'),
    checkpointId: z.string().min(
      1,
      'Checkpoint file diff checkpointId must be non-empty',
    ),
  }).readonly(),
])

export type FileDiffSource = z.infer<typeof FileDiffSourceSchema>

export const SessionStateSchema = z.enum([
  'idle',
  'starting',
  'running', 'waiting-background',
  'waiting-interaction',
  'stopping',
  'completed',
  'stopped',
  'failed',
])
export const EngineDescriptorSchema = z.strictObject({
  cliVersion: nonEmptyString('CodeM CLI version must be a non-empty string'),
})
const SessionHistoryChangeScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({
    kind: z.literal('projects'),
    projectHashes: z
      .array(SessionProjectHashSchema)
      .min(1)
      .refine(
        (projectHashes) =>
          new Set(projectHashes).size === projectHashes.length,
        { error: 'CodeM CLI history projectHashes must be unique' },
      )
      .readonly(),
  }),
])
export const SessionHistoryEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('changed'),
    revision: z.number().int().positive(),
    scope: SessionHistoryChangeScopeSchema,
  }),
  z.strictObject({
    type: z.literal('failed'),
    revision: z.number().int().positive(),
    failure: DiagnosticFailureSchema.extend({
      code: z.literal('SESSION_HISTORY_WATCH_FAILED'),
      operation: z.literal('watch-session-history'),
      retryable: z.literal(true),
    }),
  }),
])
export const ConversationUsageSchema = z.strictObject({
  inputTokens: nullableTokenCount(),
  outputTokens: nullableTokenCount(),
  cacheReadTokens: nullableTokenCount(),
  cacheCreationTokens: nullableTokenCount(),
})

const conversationItemBase = {
  id: nonEmptyString('CodeM conversation item id must be a non-empty string'),
  at: timestampString('CodeM conversation item at must be a timestamp'),
}

export const ConversationUserMessageItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('message'),
  role: z.literal('user'),
  text: z.string(),
  attachments: ConversationAttachmentListSchema,
}).superRefine(requirePromptOrAttachment('CodeM conversation user message'))

export const ReadSessionAttachmentRequestSchema = z.strictObject({
  cwd: nonEmptyString('Session attachment cwd must be non-empty'),
  sessionId: nonEmptyString('Session attachment sessionId must be non-empty'),
  attachment: SessionImageAttachmentSchema,
}).readonly()
export type ReadSessionAttachmentRequest = z.infer<
  typeof ReadSessionAttachmentRequestSchema
>
export const ConversationAssistantMessageItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('message'),
  role: z.literal('assistant'),
  text: nonEmptyString('CodeM conversation message text must be non-empty'),
  delivery: AssistantDeliverySchema.nullable(),
})
export const ConversationMessageItemSchema = z.union([
  ConversationUserMessageItemSchema,
  ConversationAssistantMessageItemSchema,
])
const conversationReasoningItemBase = {
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('reasoning'),
}
export const ConversationReasoningItemSchema = z.discriminatedUnion(
  'redacted',
  [
    z.strictObject({
      ...conversationReasoningItemBase,
      redacted: z.literal(false),
      text: nonEmptyString('CodeM reasoning text must be non-empty'),
    }),
    z.strictObject({
      ...conversationReasoningItemBase,
      redacted: z.literal(true),
      text: z.literal(REDACTED_REASONING_TEXT),
    }),
  ],
)
const conversationTodoAuditBase = {
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('todo'),
  text: nonEmptyString('CodeM Todo audit text must be non-empty'),
}
export const ConversationTodoAuditItemSchema = z.discriminatedUnion(
  'mutation',
  [
    z.strictObject({
      ...conversationTodoAuditBase,
      mutation: z.literal('reset'),
      resetAtMs: z.number().int().nonnegative(),
      summary: z.string().nullable(),
    }),
    z.strictObject({
      ...conversationTodoAuditBase,
      mutation: z.literal('added'),
      item: TodoItemSchema,
    }),
    z.strictObject({
      ...conversationTodoAuditBase,
      mutation: z.literal('updated'),
      todoId: nonEmptyString('CodeM Todo audit id must be non-empty'),
      newContent: z.string().nullable(),
      newStatus: TodoStatusSchema.nullable(),
      newActiveForm: z.string().nullable(),
      addBlockedBy: z.array(nonEmptyString(
        'CodeM Todo added dependency id must be non-empty',
      )).readonly(),
      removeBlockedBy: z.array(nonEmptyString(
        'CodeM Todo removed dependency id must be non-empty',
      )).readonly(),
      updatedAtMs: z.number().int().nonnegative(),
      evidence: z.string().nullable(),
    }),
    z.strictObject({
      ...conversationTodoAuditBase,
      mutation: z.literal('deleted'),
      todoId: nonEmptyString('CodeM Todo audit id must be non-empty'),
      deletedAtMs: z.number().int().nonnegative(),
    }),
  ],
)
export type ConversationTodoAuditItem = z.infer<
  typeof ConversationTodoAuditItemSchema
>
type ConversationTodoAuditMutationOf<Item> =
  Item extends ConversationTodoAuditItem
    ? Omit<Item, 'id' | 'kind' | 'activityType' | 'text' | 'at'>
    : never
export type ConversationTodoAuditMutation =
  ConversationTodoAuditMutationOf<ConversationTodoAuditItem>
export const ConversationStatusItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('status'),
  text: nonEmptyString('CodeM status activity text must be non-empty'),
})
export const ConversationStateItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('state'),
  text: nonEmptyString('CodeM state text must be non-empty'),
  state: z.enum(['running', 'waiting-interaction', 'completed', 'failed', 'stopped']),
})
export const ConversationSteerItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('steer'),
  requestId: nonEmptyString('CodeM steer requestId must be non-empty'),
  text: nonEmptyString('CodeM steer activity text must be non-empty'),
  result: ConversationSteerResultSchema,
  mode: SteerModeSchema,
})
export const ConversationPermissionItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('permission'),
  text: nonEmptyString('CodeM permission activity text must be non-empty'),
  request: z.lazy(() => PermissionRequestSchema),
  toolAssociation: z.enum(['associated', 'unassociated']),
  decision: PermissionDecisionSchema.nullable(),
})
export const ConversationQuestionItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('question'),
  text: nonEmptyString('CodeM question activity text must be non-empty'),
  request: z.lazy(() => UserQuestionRequestSchema),
  reply: z.lazy(() => UserQuestionReplySchema).nullable(),
})
export const ConversationPlanModeItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('plan-mode'),
  text: nonEmptyString('CodeM plan mode activity text must be non-empty'),
  requestId: nonEmptyString('CodeM plan mode requestId must be non-empty'),
  decision: PlanModeDecisionSchema.nullable(),
})
export const ConversationPlanItemSchema = z.strictObject({
  ...conversationItemBase, kind: z.literal('activity'), activityType: z.literal('plan'),
  text: nonEmptyString('CodeM plan activity text must be non-empty'),
  request: PlanReadyRequestSchema, decision: PlanDecisionSchema.nullable(),
})
const conversationBackgroundBase = {
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('background'),
  text: nonEmptyString('CodeM background activity text must be non-empty'),
  taskId: nonEmptyString('CodeM background taskId must be a non-empty string'),
  progress: z.array(z.strictObject({
    note: nonEmptyString('CodeM background progress note must be non-empty'),
    at: timestampString('CodeM background progress at must be a timestamp'),
  })).readonly(),
  questions: z.array(z.strictObject({
    questionId: nonEmptyString(
      'CodeM background questionId must be a non-empty string',
    ),
    question: nonEmptyString(
      'CodeM background question must be a non-empty string',
    ),
    askedAt: timestampString(
      'CodeM background question askedAt must be a timestamp',
    ),
    reply: z.string().nullable(),
    repliedAt: timestampString(
      'CodeM background question repliedAt must be a timestamp',
    ).nullable(),
  })).readonly(),
}
export const ConversationBackgroundItemSchema = z.union([
  z.strictObject({
    ...conversationBackgroundBase,
    origin: z.literal('live-observed'),
    label: nonEmptyString('CodeM live subagent label must be non-empty'),
    agentKind: nonEmptyString('CodeM live subagent kind must be non-empty'),
    tools: z.array(z.lazy(() => ConversationToolItemSchema)).readonly(),
    outcome: z.null(),
    report: z.null(),
    summary: z.null(),
    status: z.literal('running'),
    completedAt: z.null(),
  }),
  z.strictObject({
    ...conversationBackgroundBase,
    origin: z.literal('live-observed'),
    label: nonEmptyString('CodeM live subagent label must be non-empty'),
    agentKind: nonEmptyString('CodeM live subagent kind must be non-empty'),
    tools: z.array(z.lazy(() => ConversationToolItemSchema)).readonly(),
    outcome: z.null(),
    report: z.null(),
    summary: z.string(),
    status: z.enum(['completed', 'failed']),
    completedAt: timestampString(
      'CodeM live subagent completedAt must be a timestamp',
    ),
  }),
  z.strictObject({
    ...conversationBackgroundBase,
    origin: z.literal('dispatch-recorded'),
    label: z.string(),
    prompt: z.string(),
    source: z.string(),
    outcome: z.null(),
    report: z.null(),
    summary: z.null(),
    status: z.enum(['running', 'waiting-interaction']),
    completedAt: z.null(),
  }),
  z.strictObject({
    ...conversationBackgroundBase,
    origin: z.literal('dispatch-recorded'),
    label: z.string(),
    prompt: z.string(),
    source: z.string(),
    outcome: z.string().nullable(),
    report: z.string().nullable(),
    summary: z.string().nullable(),
    status: z.literal('completed'),
    completedAt: timestampString(
      'CodeM background completedAt must be a timestamp',
    ),
  }).refine(
    (item) => item.outcome !== null || item.report !== null,
    'CodeM completed background activity requires an outcome or report',
  ),
  z.strictObject({
    ...conversationBackgroundBase,
    origin: z.literal('dispatch-recorded'),
    label: z.string(),
    prompt: z.string(),
    source: z.string(),
    outcome: z.string(),
    report: z.string().nullable(),
    summary: z.string().nullable(),
    status: z.literal('failed'),
    completedAt: timestampString(
      'CodeM background completedAt must be a timestamp',
    ),
  }),
  z.strictObject({
    ...conversationBackgroundBase,
    origin: z.literal('dispatch-recorded'),
    label: z.string(),
    prompt: z.string(),
    source: z.string(),
    outcome: z.null(),
    report: z.null(),
    summary: z.null(),
    status: z.literal('stopped'),
    completedAt: timestampString(
      'CodeM background completedAt must be a timestamp',
    ),
  }),
  z.strictObject({
    ...conversationBackgroundBase,
    origin: z.literal('dispatch-recorded'),
    label: z.string(),
    prompt: z.string(),
    source: z.string(),
    outcome: z.null(),
    report: z.null(),
    summary: z.null(),
    status: z.literal('interrupted'),
    completedAt: timestampString(
      'CodeM background completedAt must be a timestamp',
    ),
  }),
  z.strictObject({
    ...conversationBackgroundBase,
    origin: z.literal('completion-only'),
    outcome: z.string(),
    report: z.null(),
    summary: z.string(),
    status: z.enum(['completed', 'failed']),
    completedAt: timestampString(
      'CodeM background completedAt must be a timestamp',
    ),
  }),
])
export const ConversationContextReportItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('context-report'),
  text: nonEmptyString('CodeM context report text must be non-empty'),
  reportId: nonEmptyString('CodeM context reportId must be non-empty'),
  engineTurnIndex: z.number().int().nonnegative(),
  report: ContextReportSchema,
})
export const ConversationHookItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('hook'),
  text: nonEmptyString('CodeM hook activity text must be non-empty'),
  eventName: z.string(),
  toolName: z.string(),
  handlerCommand: z.string(),
  exitCode: z.number().int().nullable(),
  elapsedMs: z.number().nonnegative(),
  blocked: z.boolean(),
})
export const ConversationGuardItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('guard'),
  text: nonEmptyString('CodeM guard activity text must be non-empty'),
  report: ToolGuardReportSchema,
})
export const ConversationRuntimeWarningItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('runtime-warning'),
  text: nonEmptyString('CodeM CLI warning activity text must be non-empty'),
  warningId: nonEmptyString('CodeM CLI warningId must be non-empty'),
  engineTurnIndex: z.number().int().nonnegative(),
  warning: RuntimeWarningSchema,
})
export const ConversationGovernanceItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('governance'),
  text: nonEmptyString('CodeM governance activity text must be non-empty'),
  snapshot: z.string(),
})
const checkpointFileBase = {
  path: nonEmptyString('CodeM checkpoint file path must be non-empty'),
  originalSize: z.number().int().nonnegative(),
  originalMtime: nonEmptyString(
    'CodeM checkpoint file original mtime must be non-empty',
  ),
}
export const ConversationCheckpointFileSchema = z.discriminatedUnion(
  'snapshotKind',
  [
    z.strictObject({
      ...checkpointFileBase,
      snapshotKind: z.literal('baseline'),
      snapshotSha: z.string().regex(
        /^[0-9a-f]{64}$/u,
        'CodeM checkpoint baseline sha must be a lowercase SHA-256 digest',
      ),
    }).readonly(),
    z.strictObject({
      ...checkpointFileBase,
      snapshotKind: z.literal('postchange'),
      snapshotSha: z.string().regex(/^[0-9a-f]{64}$/u, 'Invalid postchange SHA'),
    }).readonly(),
    z.strictObject({
      ...checkpointFileBase,
      snapshotKind: z.literal('created'),
      snapshotSha: z.literal(''),
    }).readonly(),
  ],
)
export const ConversationCheckpointSkippedPathSchema = z.strictObject({
  path: nonEmptyString('CodeM skipped checkpoint path must be non-empty'),
  reason: z.enum(['file_too_large', 'turn_too_large', 'unreadable']),
  size: z.number().int().nonnegative(),
}).readonly()
export const ConversationCheckpointItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('activity'),
  activityType: z.literal('checkpoint'),
  text: nonEmptyString('CodeM checkpoint activity text must be non-empty'),
  checkpointId: nonEmptyString('CodeM checkpoint id must be a non-empty string'),
  label: z.string(),
  files: z.array(ConversationCheckpointFileSchema).readonly(),
  skippedPaths: z.array(ConversationCheckpointSkippedPathSchema).readonly(),
})
export const ConversationToolItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('tool-execution'),
  toolCallId: nonEmptyString('CodeM tool call id must be a non-empty string'),
  toolName: nonEmptyString('CodeM tool name must be a non-empty string'),
  input: ToolPayloadSchema,
  result: ToolPayloadSchema.nullable(),
  status: z.enum(['running', 'succeeded', 'failed', 'declined', 'interrupted']),
})
export const ConversationFileDiffItemSchema = z.strictObject({
  ...conversationItemBase,
  kind: z.literal('file-diff'),
  runId: nonEmptyString('CodeM file diff runId must be a non-empty string'),
  source: FileDiffSourceSchema,
  diff: FileDiffSchema,
})
export const SessionUiFailureSchema = z.union([
  DiagnosticFailureSchema,
  FailurePresentationSchema,
])
export const ConversationErrorItemSchema = z.union([
  z.strictObject({
    ...conversationItemBase,
    kind: z.literal('error'),
    cause: z.literal('runtime'),
    text: nonEmptyString('CodeM conversation error text must be non-empty'),
  }),
  z.strictObject({
    ...conversationItemBase,
    kind: z.literal('error'),
    cause: z.literal('ui-failure'),
    failure: SessionUiFailureSchema,
  }),
])
export const ConversationItemSchema = z.union([
  ConversationMessageItemSchema,
  ConversationReasoningItemSchema,
  ConversationTodoAuditItemSchema,
  ConversationStatusItemSchema,
  ConversationStateItemSchema,
  ConversationSteerItemSchema,
  ConversationPermissionItemSchema,
  ConversationQuestionItemSchema,
  ConversationPlanModeItemSchema, ConversationPlanItemSchema,
  ConversationBackgroundItemSchema,
  ConversationContextReportItemSchema,
  ConversationRuntimeWarningItemSchema,
  ConversationHookItemSchema,
  ConversationGuardItemSchema,
  ConversationGovernanceItemSchema,
  ConversationCheckpointItemSchema,
  ConversationToolItemSchema,
  ConversationFileDiffItemSchema,
  ConversationErrorItemSchema,
])
const cliConversationTurnBase = {
  id: nonEmptyString('CodeM conversation turn id must be a non-empty string'),
  index: z.number().int().nonnegative(),
  engineTurnIndexes: z.array(z.number().int().nonnegative()).readonly(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  startedAt: timestampString(
    'CodeM conversation turn startedAt must be a timestamp',
  ),
  items: z.array(ConversationItemSchema).readonly(),
  usage: ConversationUsageSchema.nullable(),
}
export const ConversationTurnSchema = z.discriminatedUnion('state', [
  z.strictObject({
    ...cliConversationTurnBase,
    state: z.enum(['running', 'waiting-interaction']),
    completedAt: z.null(),
  }),
  z.strictObject({
    ...cliConversationTurnBase,
    state: z.enum(['completed', 'failed', 'stopped']),
    completedAt: timestampString(
      'CodeM conversation turn completedAt must be a timestamp',
    ),
  }),
])
const conversationBackgroundTaskBase = {
  taskId: nonEmptyString('CodeM background taskId must be a non-empty string'),
  parentTaskId: nonEmptyString(
    'CodeM background parentTaskId must be a non-empty string',
  ).nullable(),
}
const conversationBackgroundTaskSnapshotBase = {
  progress: conversationBackgroundBase.progress,
  questions: conversationBackgroundBase.questions,
  turns: z.array(ConversationTurnSchema).readonly(),
  usage: ConversationUsageSchema.nullable(),
}
export const ConversationBackgroundTaskSchema = z.union([
  z.strictObject({
    ...conversationBackgroundTaskBase,
    ...conversationBackgroundTaskSnapshotBase,
    transcriptStatus: z.literal('available'),
    state: z.enum(['running', 'waiting-interaction']),
    outcome: z.null(),
    report: z.null(),
    summary: z.null(),
    completedAt: z.null(),
  }),
  z.strictObject({
    ...conversationBackgroundTaskBase,
    ...conversationBackgroundTaskSnapshotBase,
    transcriptStatus: z.literal('available'),
    state: z.literal('completed'),
    outcome: nonEmptyString(
      'CodeM terminal background task outcome must be a non-empty string',
    ).nullable(),
    report: z.string().nullable(),
    summary: z.string().nullable(),
    completedAt: timestampString('CodeM background task completedAt must be a timestamp'),
  }).refine(
    (task) => task.outcome !== null || task.report !== null,
    'CodeM completed background task requires an outcome or report',
  ),
  z.strictObject({
    ...conversationBackgroundTaskBase,
    ...conversationBackgroundTaskSnapshotBase,
    transcriptStatus: z.literal('available'),
    state: z.literal('failed'),
    outcome: nonEmptyString('CodeM terminal background task outcome must be a non-empty string'),
    report: z.string().nullable(),
    summary: z.string().nullable(),
    completedAt: timestampString('CodeM background task completedAt must be a timestamp'),
  }),
  z.strictObject({
    ...conversationBackgroundTaskBase,
    ...conversationBackgroundTaskSnapshotBase,
    transcriptStatus: z.literal('available'),
    state: z.literal('stopped'),
    outcome: z.null(),
    report: z.null(),
    summary: z.null(),
    completedAt: timestampString('CodeM background task completedAt must be a timestamp'),
  }),
  z.strictObject({
    ...conversationBackgroundTaskBase,
    ...conversationBackgroundTaskSnapshotBase,
    transcriptStatus: z.literal('available'),
    state: z.literal('interrupted'),
    outcome: z.null(),
    report: z.null(),
    summary: z.null(),
    completedAt: timestampString('CodeM background task completedAt must be a timestamp'),
  }),
  z.strictObject({
    ...conversationBackgroundTaskBase,
    transcriptStatus: z.literal('unreadable'),
  }),
])
export const ConversationThreadSchema = z.strictObject({
  session: SessionHistoryItemSchema,
  state: z.enum(['running', 'waiting-interaction', 'completed', 'failed', 'stopped']),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  turns: z.array(ConversationTurnSchema).readonly(),
  backgroundTasks: z.array(ConversationBackgroundTaskSchema).readonly(),
  todoSnapshot: TodoSnapshotSchema.nullable(),
  usage: ConversationUsageSchema.nullable(),
})
export const ReadSessionHistoryResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('found'),
    thread: ConversationThreadSchema,
  }),
  z.strictObject({
    kind: z.literal('missing'),
    cwd: z.string().min(1),
    sessionId: z.string().min(1),
  }),
])
export type SessionState = z.infer<typeof SessionStateSchema>
export type EngineDescriptor = z.infer<typeof EngineDescriptorSchema>
export type SessionHistoryEvent = z.infer<typeof SessionHistoryEventSchema>
export type ConversationUsage = z.infer<typeof ConversationUsageSchema>
export type SessionUiFailure = Readonly<z.infer<typeof SessionUiFailureSchema>>
export type ConversationItem = z.infer<typeof ConversationItemSchema>
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>
export type ConversationBackgroundTask = z.infer<typeof ConversationBackgroundTaskSchema>
export type ConversationThread = z.infer<typeof ConversationThreadSchema>
export type ReadSessionHistoryResult = z.infer<
  typeof ReadSessionHistoryResultSchema
>

const SessionExportIdSchema = z.uuid({
  error: 'CodeM CLI exportId must be a UUID',
})
export const ExportSessionRequestSchema = z.strictObject({
  exportId: SessionExportIdSchema,
  cwd: nonEmptyString('CodeM CLI export cwd must be a non-empty string'),
  sessionId: nonEmptyString(
    'CodeM CLI export sessionId must be a non-empty string',
  ),
})
export const ExportSessionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('cancelled') }),
  z.strictObject({
    status: z.literal('saved'),
    filePath: nonEmptyString(
      'CodeM CLI export filePath must be a non-empty string',
    ),
  }),
])
export const SessionExportProgressSchema = z.strictObject({
  percent: z.number().int().min(0).max(100),
})
export const SessionExportProgressEventSchema = z.strictObject({
  exportId: SessionExportIdSchema,
  progress: SessionExportProgressSchema,
})
export const CancelSessionExportRequestSchema = z.strictObject({
  exportId: SessionExportIdSchema,
})
export const CancelSessionExportResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('accepted') }),
  z.strictObject({ status: z.literal('not-active') }),
  z.strictObject({ status: z.literal('committed') }),
])

export type ExportSessionRequest = z.infer<
  typeof ExportSessionRequestSchema
>
export type ExportSessionResult = z.infer<
  typeof ExportSessionResultSchema
>
export type SessionExportProgress = z.infer<
  typeof SessionExportProgressSchema
>
export type SessionExportProgressEvent = z.infer<
  typeof SessionExportProgressEventSchema
>
export type CancelSessionExportRequest = z.infer<
  typeof CancelSessionExportRequestSchema
>
export type CancelSessionExportResult = z.infer<
  typeof CancelSessionExportResultSchema
>

function nonEmptyString(message: string): z.ZodString {
  return z.string().refine((value) => value.trim().length > 0, { error: message })
}

function timestampString(message: string): z.ZodString {
  return z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    error: message,
  })
}

function nullableTokenCount() {
  return z.number().int().nonnegative().nullable()
}

function requirePromptOrAttachment(label: string) {
  return (
    value: { readonly text?: string; readonly prompt?: string; readonly attachments: readonly unknown[] },
    context: z.RefinementCtx,
  ): void => {
    const body = value.text ?? value.prompt ?? ''
    if (!body.trim() && value.attachments.length === 0) {
      context.addIssue({
        code: 'custom',
        message: `${label} requires text or an attachment`,
      })
    }
  }
}
