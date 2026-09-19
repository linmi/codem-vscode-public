import type { ConversationTodoAuditMutation } from "../../session/index.ts"
import type { MutableConversationTurn } from "./turn/model.ts"
import { sessionFileError } from "./jsonl.ts"

export function appendTodoAudit(
  turn: MutableConversationTurn,
  audit: ConversationTodoAuditMutation,
  path: string,
  lineNumber: number,
): void {
  const occurredAtMs = todoAuditTimestamp(audit)
  const at = new Date(occurredAtMs)
  if (Number.isNaN(at.getTime())) {
    throw sessionFileError(
      path,
      lineNumber,
      'Todo audit timestamp must be representable as an ISO timestamp',
    )
  }
  turn.items.push({
    id: `${turn.id}:todo:${lineNumber}`,
    kind: 'activity',
    activityType: 'todo',
    text: todoAuditText(audit),
    at: at.toISOString(),
    ...audit,
  })
  turn.segmentBoundaryPending = true
}

function todoAuditTimestamp(audit: ConversationTodoAuditMutation): number {
  switch (audit.mutation) {
    case 'reset': return audit.resetAtMs
    case 'added': return audit.item.updatedAtMs
    case 'updated': return audit.updatedAtMs
    case 'deleted': return audit.deletedAtMs
  }
}

function todoAuditText(audit: ConversationTodoAuditMutation): string {
  switch (audit.mutation) {
    case 'reset': return audit.summary ? `Todo reset: ${audit.summary}` : 'Todo reset'
    case 'added': return `Todo added: ${audit.item.content}`
    case 'updated': return `Todo updated: ${audit.todoId}`
    case 'deleted': return `Todo deleted: ${audit.todoId}`
  }
}
