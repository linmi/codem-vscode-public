import { createReadStream } from 'node:fs'

type SessionRecordVisitor = (
  record: Record<string, unknown>,
  lineNumber: number,
) => void | Promise<void>

const RECORDS_PER_EVENT_LOOP_TURN = 64

/**
 * Reads a CodeM session JSONL file as an append-only log.
 *
 * The CLI appends records while a run is active, so a read can observe the file
 * mid-write. A trailing fragment that is not newline-terminated is therefore not
 * yet a record and is skipped; every newline-terminated line must be a valid
 * record. This is the only tolerated incompleteness — an interior blank or
 * malformed line is corruption and fails explicitly.
 */
export async function visitSessionJsonLines(
  path: string,
  visit: SessionRecordVisitor,
  signal: AbortSignal | null,
): Promise<void> {
  signal?.throwIfAborted()
  const input = createReadStream(path, {
    encoding: 'utf8',
    signal: signal ?? undefined,
  })
  let pending = ''
  let lineNumber = 0
  try {
    for await (const chunk of input) {
      pending += chunk as string
      let newlineIndex = pending.indexOf('\n')
      while (newlineIndex !== -1) {
        signal?.throwIfAborted()
        const line = stripCarriageReturn(pending.slice(0, newlineIndex))
        pending = pending.slice(newlineIndex + 1)
        lineNumber += 1
        if (!line.trim()) {
          throw sessionFileError(path, lineNumber, 'blank JSONL record')
        }
        await visit(parseRecord(line, path, lineNumber), lineNumber)
        if (lineNumber % RECORDS_PER_EVENT_LOOP_TURN === 0) {
          await yieldToEventLoop()
        }
        newlineIndex = pending.indexOf('\n')
      }
    }
  } catch (error: unknown) {
    input.destroy()
    if (error instanceof Error && error.message.startsWith('Invalid CodeM session')) {
      throw error
    }
    throw new Error(
      `Failed to read CodeM session ${path} at line ${lineNumber || 1}`,
      { cause: error },
    )
  }
}

/**
 * Locates the last complete JSONL record with the requested type without
 * validating the surrounding log. This is intentionally a discovery pass:
 * the authoritative replay still uses {@link visitSessionJsonLines}, so an
 * earlier semantic error remains observable before any later malformed line.
 * Records before a discovered replay cutoff may themselves be malformed and
 * are therefore ignored here.
 */
export async function lastSessionRecordLine(
  path: string,
  type: string,
  signal: AbortSignal | null,
): Promise<number | null> {
  signal?.throwIfAborted()
  const input = createReadStream(path, {
    encoding: 'utf8',
    signal: signal ?? undefined,
  })
  let pending = ''
  let lineNumber = 0
  let lastLine: number | null = null
  try {
    for await (const chunk of input) {
      pending += chunk as string
      let newlineIndex = pending.indexOf('\n')
      while (newlineIndex !== -1) {
        signal?.throwIfAborted()
        const line = stripCarriageReturn(pending.slice(0, newlineIndex))
        pending = pending.slice(newlineIndex + 1)
        lineNumber += 1
        try {
          const value: unknown = JSON.parse(line)
          if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            (value as Record<string, unknown>).type === type
          ) {
            lastLine = lineNumber
          }
        } catch {
          // Discovery must not outrank the authoritative replay error order.
        }
        if (lineNumber % RECORDS_PER_EVENT_LOOP_TURN === 0) {
          await yieldToEventLoop()
        }
        newlineIndex = pending.indexOf('\n')
      }
    }
  } catch (error: unknown) {
    input.destroy()
    throw new Error(
      `Failed to scan CodeM session ${path} at line ${lineNumber || 1}`,
      { cause: error },
    )
  }
  return lastLine
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export function sessionFileError(
  path: string,
  lineNumber: number,
  detail: string,
  cause?: unknown,
): Error {
  return new Error(`Invalid CodeM session ${path} at line ${lineNumber}: ${detail}`, {
    cause,
  })
}

function parseRecord(
  line: string,
  path: string,
  lineNumber: number,
): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error: unknown) {
    throw sessionFileError(path, lineNumber, 'malformed JSON', error)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw sessionFileError(path, lineNumber, 'record must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.type !== 'string' || !record.type) {
    throw sessionFileError(path, lineNumber, 'record type must be a string')
  }
  return record
}
