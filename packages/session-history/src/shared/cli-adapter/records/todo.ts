import type {
  ConversationTodoAuditMutation,
  TodoItem,
  TodoSnapshot,
  TodoStatus,
} from "../../session/index.ts"
import { TodoSnapshotSchema } from "../../session/index.ts"
import {
  nullableString,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireRecord,
} from "./fields.ts"
import { sessionFileError } from "./jsonl.ts"

export function cloneTodoSnapshot(
  snapshot: TodoSnapshot | null,
): TodoSnapshot | null {
  return snapshot === null
    ? null
    : {
        ...snapshot,
        items: snapshot.items.map((item) => ({
          ...item,
          blockedBy: [...item.blockedBy],
        })),
        lastChange: snapshot.lastChange ? { ...snapshot.lastChange } : null,
        counts: { ...snapshot.counts },
      }
}

/**
 * Applies one authoritative schema-v10 Todo record to the current snapshot.
 * Returning null means the record belongs to another session projection.
 */
export function applyTodoRecord(
  state: { todoSnapshot: TodoSnapshot | null },
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): ConversationTodoAuditMutation | null {
  const current = state.todoSnapshot
  const todos = current?.items ?? []
  switch (record.type) {
    case 'todo_list_reset': {
      const resetAtMs = requireNonNegativeInteger(
        record.reset_at_ms,
        path,
        lineNumber,
        'reset_at_ms',
      )
      const summary = nullableString(
        record.new_summary,
        path,
        lineNumber,
        'new_summary',
      )
      state.todoSnapshot = validatedSnapshot({
        kind: 'reset',
        items: [],
        lastChange: null,
        counts: emptyCounts(),
        summary,
      }, path, lineNumber)
      return { mutation: 'reset', resetAtMs, summary }
    }
    case 'todo_item_added': {
      const item = parsePersistedTodoItem(record.item, path, lineNumber)
      if (todos.some((candidate) => candidate.id === item.id)) {
        throw sessionFileError(path, lineNumber, `duplicate todo ${item.id}`)
      }
      const items = [...todos, item]
      state.todoSnapshot = validatedSnapshot({
        kind: 'added',
        items,
        lastChange: { id: item.id, previousStatus: null },
        counts: todoCounts(items),
        summary: current?.summary ?? null,
      }, path, lineNumber)
      return { mutation: 'added', item }
    }
    case 'todo_item_updated': {
      const id = requireNonEmptyString(record.id, path, lineNumber, 'id')
      const itemIndex = todos.findIndex((item) => item.id === id)
      const item = todos[itemIndex]
      if (!item) {
        throw sessionFileError(
          path,
          lineNumber,
          `todo update ${id} has no matching todo`,
        )
      }
      const updatedAtMs = requireNonNegativeInteger(
        record.updated_at_ms,
        path,
        lineNumber,
        'updated_at_ms',
      )
      const evidence = nullableString(
        record.evidence,
        path,
        lineNumber,
        'evidence',
      )
      const newContent = nullableNonEmptyString(
        record.new_content,
        path,
        lineNumber,
        'new_content',
      )
      const newStatus = nullableTodoStatus(
        record.new_status,
        path,
        lineNumber,
        'new_status',
      )
      const newActiveForm = nullableString(
        record.new_active_form,
        path,
        lineNumber,
        'new_active_form',
      )
      const addBlockedBy = dependencyIds(
        record.add_blocked_by,
        path,
        lineNumber,
        'add_blocked_by',
      )
      const removeBlockedBy = dependencyIds(
        record.remove_blocked_by,
        path,
        lineNumber,
        'remove_blocked_by',
      )
      const items = [...todos]
      items[itemIndex] = {
        ...item,
        content: newContent ?? item.content,
        status: newStatus ?? item.status,
        activeForm: newActiveForm ?? item.activeForm,
        blockedBy: updatedDependencies(
          todos,
          item,
          addBlockedBy,
          removeBlockedBy,
          path,
          lineNumber,
        ),
        updatedAtMs,
      }
      state.todoSnapshot = validatedSnapshot({
        kind: 'updated',
        items,
        lastChange: { id, previousStatus: item.status },
        counts: todoCounts(items),
        summary: current?.summary ?? null,
      }, path, lineNumber)
      return {
        mutation: 'updated',
        todoId: id,
        newContent,
        newStatus,
        newActiveForm,
        addBlockedBy,
        removeBlockedBy,
        updatedAtMs,
        evidence,
      }
    }
    case 'todo_item_deleted': {
      const id = requireNonEmptyString(record.id, path, lineNumber, 'id')
      const deletedAtMs = requireNonNegativeInteger(
        record.deleted_at_ms,
        path,
        lineNumber,
        'deleted_at_ms',
      )
      const itemIndex = todos.findIndex((item) => item.id === id)
      if (itemIndex < 0) {
        throw sessionFileError(
          path,
          lineNumber,
          `todo delete ${id} has no matching todo`,
        )
      }
      const deleted = todos[itemIndex]
      const items = todos.filter((_, index) => index !== itemIndex)
      for (let index = 0; index < items.length; index += 1) {
        const candidate = items[index]
        items[index] = {
          ...candidate,
          blockedBy: candidate.blockedBy.filter((dependency) => dependency !== id),
        }
      }
      state.todoSnapshot = validatedSnapshot({
        kind: 'deleted',
        items,
        lastChange: { id, previousStatus: deleted.status },
        counts: todoCounts(items),
        summary: current?.summary ?? null,
      }, path, lineNumber)
      return { mutation: 'deleted', todoId: id, deletedAtMs }
    }
    default:
      return null
  }
}

function parsePersistedTodoItem(
  value: unknown,
  path: string,
  lineNumber: number,
): TodoItem {
  const item = requireRecord(value, path, lineNumber, 'item')
  return {
    id: requireNonEmptyString(item.id, path, lineNumber, 'item.id'),
    content: requireNonEmptyString(
      item.content,
      path,
      lineNumber,
      'item.content',
    ),
    activeForm: nullableString(
      item.active_form,
      path,
      lineNumber,
      'item.active_form',
    ),
    blockedBy: dependencyIds(item.blocked_by, path, lineNumber, 'item.blocked_by'),
    status: requireTodoStatus(item.status, path, lineNumber, 'item.status'),
    createdAtMs: requireNonNegativeInteger(
      item.created_at_ms,
      path,
      lineNumber,
      'item.created_at_ms',
    ),
    updatedAtMs: requireNonNegativeInteger(
      item.updated_at_ms,
      path,
      lineNumber,
      'item.updated_at_ms',
    ),
  }
}

function emptyCounts(): TodoSnapshot['counts'] {
  return { completed: 0, inProgress: 0, pending: 0 }
}

function todoCounts(items: readonly TodoItem[]): TodoSnapshot['counts'] {
  const counts = emptyCounts()
  for (const item of items) {
    if (item.status === 'in_progress') counts.inProgress += 1
    else counts[item.status] += 1
  }
  return counts
}

function validatedSnapshot(
  snapshot: TodoSnapshot,
  path: string,
  lineNumber: number,
): TodoSnapshot {
  const parsed = TodoSnapshotSchema.safeParse(snapshot)
  if (parsed.success) return parsed.data
  throw sessionFileError(
    path,
    lineNumber,
    parsed.error.issues[0]?.message ?? 'invalid todo snapshot',
  )
}

function updatedDependencies(
  todos: readonly TodoItem[],
  item: TodoItem,
  added: readonly string[],
  removedIds: readonly string[],
  path: string,
  lineNumber: number,
): readonly string[] {
  const removed = new Set(removedIds)
  const knownIds = new Set(todos.map((todo) => todo.id))
  for (const dependency of added) {
    if (!knownIds.has(dependency)) {
      throw sessionFileError(
        path,
        lineNumber,
        `add_blocked_by contains unknown todo ${dependency}`,
      )
    }
    if (dependency === item.id) {
      throw sessionFileError(path, lineNumber, `todo ${item.id} cannot block itself`)
    }
  }
  return [...new Set([
    ...item.blockedBy.filter((dependency) => !removed.has(dependency)),
    ...added,
  ])]
}

function dependencyIds(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw sessionFileError(path, lineNumber, `${field} must be an array`)
  }
  const dependencies = value.map((dependency, index) =>
    requireNonEmptyString(dependency, path, lineNumber, `${field}[${index}]`),
  )
  if (new Set(dependencies).size !== dependencies.length) {
    throw sessionFileError(path, lineNumber, `${field} must not contain duplicates`)
  }
  return dependencies
}

function nullableNonEmptyString(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): string | null {
  if (value === null || value === undefined) return null
  return requireNonEmptyString(value, path, lineNumber, field)
}

function nullableTodoStatus(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): TodoStatus | null {
  if (value === null || value === undefined) return null
  return requireTodoStatus(value, path, lineNumber, field)
}

function requireTodoStatus(
  value: unknown,
  path: string,
  lineNumber: number,
  field: string,
): TodoStatus {
  if (value === 'pending' || value === 'in_progress' || value === 'completed') {
    return value
  }
  throw sessionFileError(
    path,
    lineNumber,
    `${field} has unsupported todo status ${String(value)}`,
  )
}
