import {
  PermissionDecisionSchema,
  PermissionRequestSchema,
  PlanDecisionSchema,
  PlanModeDecisionSchema,
  SteerModeSchema,
  type PermissionDecision,
  type PermissionRequest,
  type PlanDecision,
  type PlanModeDecision,
  type SteerMode,
} from "../../session/index.ts"
import { sessionFileError } from "./jsonl.ts"
import {
  requireBoolean,
  requireNonEmptyString,
  requireRecord,
  requireString,
} from "./fields.ts"

export function parseDurablePermissionRequest(
  value: unknown,
  path: string,
  lineNumber: number,
): PermissionRequest {
  const request = requireRecord(value, path, lineNumber, 'request')
  const parsed = PermissionRequestSchema.safeParse({
    requestId: requireNonEmptyString(
      request.request_id,
      path,
      lineNumber,
      'request.request_id',
    ),
    toolCallId: requireNonEmptyString(
      request.tool_call_id,
      path,
      lineNumber,
      'request.tool_call_id',
    ),
    toolName: requireNonEmptyString(
      request.tool_name,
      path,
      lineNumber,
      'request.tool_name',
    ),
    inputSummary: requireString(
      request.input_summary,
      path,
      lineNumber,
      'request.input_summary',
    ),
    permissionClass: request.permission_class,
    // A durable audit item is not a live rendezvous and therefore cannot offer
    // another session-scoped grant after recovery.
    allowSession: false,
    preview: permissionPreview(request.preview, path, lineNumber),
  })
  if (!parsed.success) {
    throw sessionFileError(
      path,
      lineNumber,
      `invalid durable permission request: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

export function parseDurablePermissionDecision(
  value: unknown,
  path: string,
  lineNumber: number,
): PermissionDecision {
  const candidate = typeof value === 'string'
    ? { kind: value }
    : externallyTaggedPermissionDecision(value, path, lineNumber)
  const parsed = PermissionDecisionSchema.safeParse(candidate)
  if (!parsed.success) {
    throw sessionFileError(
      path,
      lineNumber,
      `invalid durable permission decision: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

function externallyTaggedPermissionDecision(
  value: unknown,
  path: string,
  lineNumber: number,
): unknown {
  const decision = requireRecord(value, path, lineNumber, 'decision')
  const fields = Object.keys(decision)
  if (fields.length !== 1 || fields[0] !== 'allow_session_scoped') {
    throw sessionFileError(
      path,
      lineNumber,
      'decision must be a string or externally tagged allow_session_scoped value',
    )
  }
  const scoped = requireRecord(
    decision.allow_session_scoped,
    path,
    lineNumber,
    'decision.allow_session_scoped',
  )
  return {
    kind: 'allow_session_scoped',
    scope: permissionScope(
      scoped.scope,
      path,
      lineNumber,
      'decision.allow_session_scoped.scope',
    ),
  }
}

export function parseDurablePlanDecision(
  value: unknown,
  path: string,
  lineNumber: number,
): PlanDecision {
  const parsed = PlanDecisionSchema.safeParse(value)
  if (!parsed.success) {
    throw sessionFileError(path, lineNumber, `invalid plan decision: ${parsed.error.message}`)
  }
  return parsed.data
}

export function parseDurablePlanModeDecision(
  value: unknown,
  path: string,
  lineNumber: number,
): PlanModeDecision {
  const decision = requireRecord(value, path, lineNumber, 'decision')
  const parsed = PlanModeDecisionSchema.safeParse(decision.kind)
  if (!parsed.success) {
    throw sessionFileError(
      path,
      lineNumber,
      `invalid plan mode decision: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

export function parseDurableSteerMode(
  value: unknown,
  path: string,
  lineNumber: number,
): SteerMode {
  const parsed = SteerModeSchema.safeParse(value)
  if (!parsed.success) {
    throw sessionFileError(path, lineNumber, `invalid steer mode: ${parsed.error.message}`)
  }
  return parsed.data
}

function permissionPreview(
  value: unknown,
  path: string,
  lineNumber: number,
): unknown {
  const preview = requireRecord(value, path, lineNumber, 'request.preview')
  const kind = requireNonEmptyString(
    preview.kind,
    path,
    lineNumber,
    'request.preview.kind',
  )
  switch (kind) {
    case 'bash_command':
      return {
        kind,
        cwd: requireString(preview.cwd, path, lineNumber, 'request.preview.cwd'),
        command: requireString(
          preview.command,
          path,
          lineNumber,
          'request.preview.command',
        ),
        risk: bashRisk(preview.risk, path, lineNumber),
        suggestedRules: stringList(
          preview.suggested_rules,
          path,
          lineNumber,
          'request.preview.suggested_rules',
        ),
      }
    case 'file_write':
      return {
        kind,
        path: requireString(preview.path, path, lineNumber, 'request.preview.path'),
        changeSummary: requireString(
          preview.change_summary,
          path,
          lineNumber,
          'request.preview.change_summary',
        ),
        diffExcerpt: nullableString(preview.diff_excerpt, path, lineNumber, 'request.preview.diff_excerpt'),
        rootSuggestion: nullableString(preview.root_suggestion, path, lineNumber, 'request.preview.root_suggestion'),
      }
    case 'file_read':
      return {
        kind,
        path: requireString(preview.path, path, lineNumber, 'request.preview.path'),
        access: preview.access,
        scopeSuggestion: nullableString(preview.scope_suggestion, path, lineNumber, 'request.preview.scope_suggestion'),
      }
    case 'mcp':
      return {
        kind,
        server: requireString(preview.server, path, lineNumber, 'request.preview.server'),
        originalTool: requireString(preview.original_tool, path, lineNumber, 'request.preview.original_tool'),
        argsRedacted: requireString(preview.args_redacted, path, lineNumber, 'request.preview.args_redacted'),
      }
    case 'web_fetch':
      return {
        kind,
        url: requireString(preview.url, path, lineNumber, 'request.preview.url'),
        host: requireString(preview.host, path, lineNumber, 'request.preview.host'),
      }
    case 'web_search':
      return {
        kind,
        query: requireString(preview.query, path, lineNumber, 'request.preview.query'),
      }
    case 'generic':
      return {
        kind,
        summary: requireString(preview.summary, path, lineNumber, 'request.preview.summary'),
      }
    default:
      throw sessionFileError(path, lineNumber, `unsupported permission preview ${kind}`)
  }
}

function bashRisk(
  value: unknown,
  path: string,
  lineNumber: number,
): unknown {
  const risk = requireRecord(value, path, lineNumber, 'request.preview.risk')
  const kind = requireNonEmptyString(risk.kind, path, lineNumber, 'request.preview.risk.kind')
  switch (kind) {
    case 'normal':
      return { kind }
    case 'warn':
      return { kind, reason: requireString(risk.reason, path, lineNumber, 'request.preview.risk.reason') }
    case 'outside_workspace':
      return {
        kind,
        paths: stringList(risk.paths, path, lineNumber, 'request.preview.risk.paths'),
        uncertainSyntax: requireBoolean(
          risk.uncertain_syntax,
          path,
          lineNumber,
          'request.preview.risk.uncertain_syntax',
        ),
      }
    case 'sensitive':
      return {
        kind,
        sensitivePaths: stringList(risk.sensitive_paths, path, lineNumber, 'request.preview.risk.sensitive_paths'),
        flagBypass: nullableString(risk.flag_bypass, path, lineNumber, 'request.preview.risk.flag_bypass'),
        cdWithWrite: requireBoolean(risk.cd_with_write, path, lineNumber, 'request.preview.risk.cd_with_write'),
        outsidePaths: stringList(risk.outside_paths, path, lineNumber, 'request.preview.risk.outside_paths'),
      }
    default:
      throw sessionFileError(path, lineNumber, `unsupported bash risk ${kind}`)
  }
}

function permissionScope(
  value: unknown,
  path: string,
  lineNumber: number,
  field = 'decision.scope',
): unknown {
  const scope = requireRecord(value, path, lineNumber, field)
  const kind = requireNonEmptyString(scope.kind, path, lineNumber, `${field}.kind`)
  switch (kind) {
    case 'class':
      return { kind, permissionClass: scope.class }
    case 'write_path_prefix':
    case 'read_path_prefix':
    case 'bash_command_prefix':
      return { kind, prefix: scope.prefix }
    case 'write_path_exact':
      return { kind, path: scope.path }
    case 'bash_command_exact':
      return { kind, command: scope.command }
    case 'tool_name':
      return { kind, name: scope.name }
    case 'bash_rules':
      return { kind, rules: scope.rules }
    case 'web_fetch_host':
      return { kind, host: scope.host }
    case 'writable_root':
      return { kind, root: scope.root }
    case 'web_search_session':
    case 'accept_edits_session':
      return { kind }
    default:
      throw sessionFileError(path, lineNumber, `unsupported permission scope ${kind}`)
  }
}

function stringList(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw sessionFileError(path, lineNumber, `${field} must be an array of strings`)
  }
  return value
}

function nullableString(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): string | null {
  return value === null ? null : requireString(value, path, lineNumber, field)
}
