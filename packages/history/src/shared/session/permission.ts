import { z } from 'zod'

const nonEmptyScopeString = z.string().refine(
  (value) => value.trim().length > 0,
  'Permission scope value must be non-empty',
)
const nonEmptyPermissionString = (message: string) => z.string().refine(
  (value) => value.trim().length > 0,
  message,
)

export const PermissionModeSchema = z.enum(['default', 'auto', 'yolo'], {
  error: (issue) => `Unsupported permission mode: ${String(issue.input)}`,
})
export const PermissionClassSchema = z.enum(['read', 'write', 'exec'])
export const BashRiskLevelSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('normal') }),
  z.strictObject({ kind: z.literal('warn'), reason: z.string() }),
  z.strictObject({
    kind: z.literal('outside_workspace'),
    paths: z.array(z.string()).readonly(),
    uncertainSyntax: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('sensitive'),
    sensitivePaths: z.array(z.string()).readonly(),
    flagBypass: z.string().nullable(),
    cdWithWrite: z.boolean(),
    outsidePaths: z.array(z.string()).readonly(),
  }),
])
export const PermissionPreviewSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('bash_command'),
    cwd: z.string(),
    command: z.string(),
    risk: BashRiskLevelSchema,
    suggestedRules: z.array(z.string()).readonly(),
  }),
  z.strictObject({
    kind: z.literal('file_write'),
    path: z.string(),
    changeSummary: z.string(),
    diffExcerpt: z.string().nullable(),
    rootSuggestion: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal('file_read'),
    path: z.string(),
    access: z.enum(['sensitive', 'outside_workspace']),
    scopeSuggestion: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal('mcp'),
    server: z.string(),
    originalTool: z.string(),
    argsRedacted: z.string(),
  }),
  z.strictObject({ kind: z.literal('web_fetch'), url: z.string(), host: z.string() }),
  z.strictObject({ kind: z.literal('web_search'), query: z.string() }),
  z.strictObject({ kind: z.literal('generic'), summary: z.string() }),
])
export const PermissionAllowScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('class'), permissionClass: PermissionClassSchema }),
  z.strictObject({ kind: z.literal('write_path_prefix'), prefix: nonEmptyScopeString }),
  z.strictObject({ kind: z.literal('write_path_exact'), path: nonEmptyScopeString }),
  z.strictObject({ kind: z.literal('bash_command_exact'), command: nonEmptyScopeString }),
  z.strictObject({ kind: z.literal('tool_name'), name: nonEmptyScopeString }),
  z.strictObject({ kind: z.literal('read_path_prefix'), prefix: nonEmptyScopeString }),
  z.strictObject({ kind: z.literal('bash_command_prefix'), prefix: nonEmptyScopeString }),
  z.strictObject({
    kind: z.literal('bash_rules'),
    rules: z.array(nonEmptyScopeString).min(1).readonly(),
  }),
  z.strictObject({ kind: z.literal('web_fetch_host'), host: nonEmptyScopeString }),
  z.strictObject({ kind: z.literal('web_search_session') }),
  z.strictObject({ kind: z.literal('accept_edits_session') }),
  z.strictObject({ kind: z.literal('writable_root'), root: nonEmptyScopeString }),
])
export const SessionScopedPermissionDecisionSchema = z.strictObject({
  kind: z.literal('allow_session_scoped'),
  scope: PermissionAllowScopeSchema,
})
// Core 0.8.50's Decision enum also has a `selected` choice variant. Real
// sessions record the Default-mode "allow and switch to Auto" choice as the
// plain string `allow_once_and_enable_auto`; `selected` has not been observed.
export const SelectedPermissionDecisionSchema = z.strictObject({
  kind: z.literal('selected'),
  choiceId: nonEmptyPermissionString('CodeM CLI permission choiceId must be a non-empty string'),
  presentationId: nonEmptyPermissionString('CodeM CLI permission presentationId must be a non-empty string'),
  autoChoicePresented: z.boolean(),
})
export const PermissionDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('allow') }),
  z.strictObject({ kind: z.literal('allow_session') }),
  z.strictObject({ kind: z.literal('allow_once_and_enable_auto') }),
  SessionScopedPermissionDecisionSchema,
  SelectedPermissionDecisionSchema,
  z.strictObject({ kind: z.literal('deny') }),
])
export const PermissionRequestSchema = z.strictObject({
  requestId: nonEmptyPermissionString(
    'CodeM CLI permission requestId must be a non-empty string',
  ),
  // null = unbound: desktop correlation failed, answered as a standalone approval.
  toolCallId: nonEmptyPermissionString(
    'CodeM CLI permission toolCallId must be a non-empty string',
  ).nullable(),
  toolName: nonEmptyPermissionString(
    'CodeM CLI toolName must be a non-empty string',
  ),
  inputSummary: z.string(),
  permissionClass: PermissionClassSchema,
  // App Server owns the exact, narrowest session scope. Desktop may only
  // offer a session approval when the request explicitly includes
  // `allow_always`; it must never reconstruct or broaden that scope.
  allowSession: z.boolean(),
  preview: PermissionPreviewSchema,
})

export type PermissionMode = z.infer<typeof PermissionModeSchema>
export type PermissionClass = z.infer<typeof PermissionClassSchema>
export type BashRiskLevel = z.infer<typeof BashRiskLevelSchema>
export type PermissionPreview = z.infer<typeof PermissionPreviewSchema>
export type PermissionAllowScope = z.infer<typeof PermissionAllowScopeSchema>
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>
