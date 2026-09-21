import type { ConversationAttachment } from "../../session/index.ts"
import {
  requireNonEmptyString,
  requireRecord,
  requireString,
  requireTimestamp,
} from "./fields.ts"
import { sessionFileError } from "./jsonl.ts"
import type { CodeMTurnInitialSubmission } from "./projection-port.ts"
import { parseSessionImageAttachments } from "./session-image-attachments.ts"

export interface ParsedUserInvocation {
  readonly startedAt: string
  readonly text: string
  readonly attachments: readonly ConversationAttachment[]
  readonly initialSubmission: Extract<
    CodeMTurnInitialSubmission,
    { readonly source: 'user-invocation' }
  >
}

export function parseUserInvocation(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): ParsedUserInvocation {
  const startedAt = requireTimestamp(record.at, path, lineNumber, 'at')
  const input = requireRecord(record.input, path, lineNumber, 'input')
  const inputKind = requireNonEmptyString(
    input.kind,
    path,
    lineNumber,
    'input.kind',
  )
  if (inputKind !== 'message' && inputKind !== 'skill') {
    throw sessionFileError(
      path,
      lineNumber,
      'input.kind must be message or skill',
    )
  }
  const submissionId = parseInvocationSubmissionId(record, path, lineNumber)
  if (inputKind === 'message') {
    const text = requireString(input.content, path, lineNumber, 'input.content')
    const attachments = parseSessionImageAttachments(
      input.attachments,
      path,
      lineNumber,
    )
    if (!text.trim() && attachments.length === 0) {
      throw sessionFileError(
        path,
        lineNumber,
        'user invocation message requires text or an attachment',
      )
    }
    return {
      startedAt,
      text,
      attachments,
      initialSubmission: {
        source: 'user-invocation',
        inputKind,
        submissionId,
      },
    }
  }

  const name = requireNonEmptyString(input.name, path, lineNumber, 'input.name')
  if (name !== name.trim()) {
    throw sessionFileError(
      path,
      lineNumber,
      'input.name must not have surrounding whitespace',
    )
  }
  const argumentsText = input.arguments === undefined || input.arguments === null
    ? null
    : requireString(input.arguments, path, lineNumber, 'input.arguments')
  return {
    startedAt,
    text: argumentsText === null ? `/${name}` : `/${name} ${argumentsText}`,
    attachments: [],
    initialSubmission: {
      source: 'user-invocation',
      inputKind,
      submissionId,
    },
  }
}

export function validateHiddenModelInput(
  record: Record<string, unknown>,
  initialSubmission: CodeMTurnInitialSubmission | null,
  path: string,
  lineNumber: number,
): void {
  if (initialSubmission?.source !== 'user-invocation') {
    throw sessionFileError(
      path,
      lineNumber,
      'model input appears before the first user invocation',
    )
  }
  requireTimestamp(record.at, path, lineNumber, 'at')
  requireString(record.content, path, lineNumber, 'content')
  parseSessionImageAttachments(record.attachments, path, lineNumber)
}

function parseInvocationSubmissionId(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): string | null {
  if (record.submission_id === undefined || record.submission_id === null) {
    return null
  }
  const submissionId = requireNonEmptyString(
    record.submission_id,
    path,
    lineNumber,
    'submission_id',
  )
  if (submissionId !== submissionId.trim()) {
    throw sessionFileError(
      path,
      lineNumber,
      'submission_id must not have surrounding whitespace',
    )
  }
  return submissionId
}
