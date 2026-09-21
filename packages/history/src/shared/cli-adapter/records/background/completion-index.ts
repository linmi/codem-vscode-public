import { sessionFileError, visitSessionJsonLines } from "../jsonl.ts"
import {
  requireNonEmptyString,
  requireRecord,
  requireString,
  requireTimestamp,
  summarize,
} from "../fields.ts"

export interface BackgroundCompletion {
  readonly taskId: string
  readonly outcome: string
  readonly summary: string
  readonly state: 'completed' | 'failed'
  readonly at: string
}

export function parseBackgroundCompletion(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): BackgroundCompletion {
  const outcome = parseBackgroundOutcome(record.outcome, path, lineNumber)
  return {
    taskId: requireNonEmptyString(record.task_id, path, lineNumber, 'task_id'),
    outcome: outcome.encoded,
    summary: requireString(record.summary, path, lineNumber, 'summary'),
    state: outcome.state,
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  }
}

function parseBackgroundOutcome(
  value: unknown,
  path: string,
  lineNumber: number,
): {
  readonly encoded: string
  readonly state: BackgroundCompletion['state']
} {
  const outcome = requireRecord(value, path, lineNumber, 'outcome')
  const kind = requireNonEmptyString(
    outcome.kind,
    path,
    lineNumber,
    'outcome.kind',
  )
  if (kind === 'completed') {
    if (Object.keys(outcome).some((key) => key !== 'kind')) {
      throw sessionFileError(
        path,
        lineNumber,
        'completed background outcome contains unsupported fields',
      )
    }
    return { encoded: summarize(outcome), state: 'completed' }
  }
  if (kind === 'failed') {
    requireNonEmptyString(outcome.error, path, lineNumber, 'outcome.error')
    if (Object.keys(outcome).some((key) => key !== 'kind' && key !== 'error')) {
      throw sessionFileError(
        path,
        lineNumber,
        'failed background outcome contains unsupported fields',
      )
    }
    return { encoded: summarize(outcome), state: 'failed' }
  }
  throw sessionFileError(
    path,
    lineNumber,
    `unsupported background outcome kind ${kind}`,
  )
}

interface IndexedBackgroundCompletion {
  readonly taskId: string
}

export async function readBackgroundCompletionIndex<
  Completion extends IndexedBackgroundCompletion,
>(
  path: string,
  parse: (
    record: Record<string, unknown>,
    lineNumber: number,
  ) => Completion,
  signal: AbortSignal | null,
  firstIncludedLine = 1,
): Promise<ReadonlyMap<string, Completion>> {
  const completions = new Map<string, Completion>()
  try {
    await visitSessionJsonLines(path, (record, lineNumber) => {
      if (record.type !== 'background_completed') return
      if (lineNumber < firstIncludedLine) return
      const completion = parse(record, lineNumber)
      if (!completions.has(completion.taskId)) {
        completions.set(completion.taskId, completion)
      }
    }, signal)
  } catch (error: unknown) {
    if (!(error instanceof Error) || !error.message.startsWith('Invalid CodeM session')) {
      throw error
    }
  }
  return completions
}
