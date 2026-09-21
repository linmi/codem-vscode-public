import type { ConversationItem } from "../../session/index.ts"
import {
  nullableInteger,
  requireBoolean,
  requireNonNegativeNumber,
  requireString,
  requireTimestamp,
} from "./fields.ts"

export type ParsedHookExecution = Omit<
  Extract<
    ConversationItem,
    { kind: 'activity'; activityType: 'hook' }
  >,
  'id'
>

export function parseHookExecution(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): ParsedHookExecution {
  const eventName = requireString(record.event_name, path, lineNumber, 'event_name')
  return {
    kind: 'activity',
    activityType: 'hook',
    text: eventName ? `已执行 Hook：${eventName}` : '已执行 Hook',
    eventName,
    toolName: requireString(record.tool_name, path, lineNumber, 'tool_name'),
    handlerCommand: requireString(
      record.handler_command,
      path,
      lineNumber,
      'handler_command',
    ),
    exitCode: nullableInteger(record.exit_code, path, lineNumber, 'exit_code'),
    elapsedMs: requireNonNegativeNumber(
      record.elapsed_ms,
      path,
      lineNumber,
      'elapsed_ms',
    ),
    blocked: requireBoolean(record.blocked, path, lineNumber, 'blocked'),
    at: requireTimestamp(record.at, path, lineNumber, 'at'),
  }
}
