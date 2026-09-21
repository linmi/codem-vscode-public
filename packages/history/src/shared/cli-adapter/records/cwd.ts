import { createHash } from 'node:crypto'
import { isAbsolute, win32 } from 'node:path'
import { nullableString, requireNonEmptyString, requireTimestamp } from "./fields.ts"
import { sessionFileError } from "./jsonl.ts"

export interface SessionHeader {
  readonly sessionId: string
  readonly startedAt: string
  readonly cwd: string
  readonly model: string | null
  readonly provider: string | null
}

interface RequestedSessionIdentity {
  readonly kind: 'requested-cwd'
  readonly cwd: string
  readonly sessionId: string
}

interface ScannedSessionIdentity {
  readonly kind: 'project-hash'
  readonly projectHash: string
  readonly sessionId: string
}

export type ExpectedSessionIdentity =
  | RequestedSessionIdentity
  | ScannedSessionIdentity

export interface BackgroundTaskRecordIdentity {
  readonly rootSessionId: string
  readonly taskId: string
  readonly expectedCwd: string
  readonly fallbackModel: string | null
}

export interface BackgroundTaskIdentity extends BackgroundTaskRecordIdentity {
  readonly kind: 'background-task'
}

export type ConversationReducerIdentity =
  | ExpectedSessionIdentity
  | BackgroundTaskIdentity

export function parseBackgroundHeader(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
  identity: BackgroundTaskIdentity,
): SessionHeader {
  validateSessionSchemaVersion(record.schema_version, path, lineNumber)
  const sessionId = requireNonEmptyString(
    record.session_id,
    path,
    lineNumber,
    'session_id',
  )
  if (sessionId !== identity.taskId) {
    throw sessionFileError(
      path,
      lineNumber,
      `header session_id ${sessionId} does not match file name ${identity.taskId}`,
    )
  }
  const persistedCwd = requireNonEmptyString(record.cwd, path, lineNumber, 'cwd')
  if (!isAbsolute(persistedCwd)) {
    throw sessionFileError(path, lineNumber, 'header cwd must be an absolute path')
  }
  if (!codeMCwdsEqual(persistedCwd, identity.expectedCwd)) {
    throw sessionFileError(
      path,
      lineNumber,
      `background header cwd ${persistedCwd} does not match root session cwd ${identity.expectedCwd}`,
    )
  }
  return sessionHeader(
    record,
    path,
    lineNumber,
    sessionId,
    nativeCodeMCwd(persistedCwd),
  )
}

export function parseHeader(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
  expectedIdentity: ExpectedSessionIdentity,
): SessionHeader {
  validateSessionSchemaVersion(record.schema_version, path, lineNumber)
  const sessionId = requireNonEmptyString(
    record.session_id,
    path,
    lineNumber,
    'session_id',
  )
  if (sessionId !== expectedIdentity.sessionId) {
    throw sessionFileError(
      path,
      lineNumber,
      `header session_id ${sessionId} does not match file name ${expectedIdentity.sessionId}`,
    )
  }
  const persistedCwd = requireNonEmptyString(record.cwd, path, lineNumber, 'cwd')
  if (!isAbsolute(persistedCwd)) {
    throw sessionFileError(path, lineNumber, 'header cwd must be an absolute path')
  }
  if (
    expectedIdentity.kind === 'requested-cwd' &&
    !codeMCwdsEqual(persistedCwd, expectedIdentity.cwd)
  ) {
    throw sessionFileError(
      path,
      lineNumber,
      `header cwd ${persistedCwd} does not match requested cwd ${expectedIdentity.cwd}`,
    )
  }
  if (
    expectedIdentity.kind === 'project-hash' &&
    projectHashForCwd(persistedCwd) !== expectedIdentity.projectHash
  ) {
    throw sessionFileError(
      path,
      lineNumber,
      `header cwd project hash does not match session directory ${expectedIdentity.projectHash}`,
    )
  }
  return sessionHeader(
    record,
    path,
    lineNumber,
    sessionId,
    expectedIdentity.kind === 'requested-cwd'
      ? expectedIdentity.cwd
      : nativeCodeMCwd(persistedCwd),
  )
}

function sessionHeader(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
  sessionId: string,
  cwd: string,
): SessionHeader {
  return {
    sessionId,
    cwd,
    startedAt: requireTimestamp(record.started_at, path, lineNumber, 'started_at'),
    model: nullableString(record.model, path, lineNumber, 'model'),
    provider: nullableString(record.provider, path, lineNumber, 'provider'),
  }
}

function validateSessionSchemaVersion(
  value: unknown,
  path: string,
  lineNumber: number,
): void {
  if (value !== 13) {
    throw sessionFileError(
      path,
      lineNumber,
      `unsupported schema_version ${String(value)}; pinned Core requires schema 13`,
    )
  }
}

export function projectHashForCwd(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return createHash('sha256')
    .update(persistedCodeMCwd(cwd, platform))
    .digest('hex')
    .slice(0, 16)
}

export function codeMCwdsEqual(
  left: string,
  right: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const persistedLeft = persistedCodeMCwd(left, platform)
  const persistedRight = persistedCodeMCwd(right, platform)
  return platform === 'win32'
    ? persistedLeft.toLowerCase() === persistedRight.toLowerCase()
    : persistedLeft === persistedRight
}

export function nativeCodeMCwd(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return cwd
  const normalized = win32.normalize(cwd)
  if (normalized.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${normalized.slice(8)}`
  }
  return normalized.startsWith('\\\\?\\')
    ? normalized.slice(4)
    : normalized
}

function persistedCodeMCwd(
  cwd: string,
  platform: NodeJS.Platform,
): string {
  return platform === 'win32'
    ? nativeCodeMCwd(cwd, platform).replaceAll('\\', '/')
    : cwd
}
