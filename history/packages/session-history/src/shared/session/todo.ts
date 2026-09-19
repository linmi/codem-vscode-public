import { z } from 'zod'

export const TodoStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
])
export const TodoItemSchema = z.strictObject({
  id: nonEmptyString('CodeM todo id must be a non-empty string'),
  content: nonEmptyString('CodeM todo content must be a non-empty string'),
  activeForm: z.string().nullable(),
  blockedBy: z.array(nonEmptyString(
    'CodeM todo dependency id must be a non-empty string',
  )).readonly(),
  status: TodoStatusSchema,
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
}).superRefine((item, context) => {
  if (item.updatedAtMs < item.createdAtMs) {
    context.addIssue({
      code: 'custom',
      path: ['updatedAtMs'],
      message: 'CodeM todo updatedAtMs must not precede createdAtMs',
    })
  }
})

export const TodoCountsSchema = z.strictObject({
  completed: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
})

export const TodoLastChangeSchema = z.strictObject({
  id: nonEmptyString('CodeM todo last-change id must be a non-empty string'),
  previousStatus: TodoStatusSchema.nullable(),
})

export const TodoSnapshotSchema = z.strictObject({
  kind: nonEmptyString('CodeM todo snapshot kind must be a non-empty string'),
  items: z.array(TodoItemSchema).readonly(),
  lastChange: TodoLastChangeSchema.nullable(),
  counts: TodoCountsSchema,
  summary: z.string().nullable(),
}).superRefine(validateTodoSnapshot)

export type TodoStatus = z.infer<typeof TodoStatusSchema>
export type TodoItem = z.infer<typeof TodoItemSchema>
export type TodoCounts = z.infer<typeof TodoCountsSchema>
export type TodoLastChange = z.infer<typeof TodoLastChangeSchema>
export type TodoSnapshot = z.infer<typeof TodoSnapshotSchema>

function validateTodoSnapshot(
  snapshot: z.infer<typeof TodoSnapshotSchema>,
  context: z.RefinementCtx,
): void {
  const byId = new Map<string, number>()
  snapshot.items.forEach((item, index) => {
    const previous = byId.get(item.id)
    if (previous !== undefined) {
      context.addIssue({
        code: 'custom', path: ['items', index, 'id'],
        message: `CodeM todo snapshot contains duplicate id ${item.id}`,
      })
    } else {
      byId.set(item.id, index)
    }
  })
  snapshot.items.forEach((item, index) => {
    for (const dependency of item.blockedBy) {
      if (dependency === item.id) {
        context.addIssue({
          code: 'custom', path: ['items', index, 'blockedBy'],
          message: `CodeM todo ${item.id} cannot depend on itself`,
        })
      } else if (!byId.has(dependency)) {
        context.addIssue({
          code: 'custom', path: ['items', index, 'blockedBy'],
          message: `CodeM todo ${item.id} references unknown dependency ${dependency}`,
        })
      }
    }
  })
  if (todoDependencyCycle(snapshot.items)) {
    context.addIssue({
      code: 'custom', path: ['items'],
      message: 'CodeM todo dependency graph contains a cycle',
    })
  }
  const actual: TodoCounts = { completed: 0, inProgress: 0, pending: 0 }
  for (const item of snapshot.items) {
    if (item.status === 'in_progress') actual.inProgress += 1
    else actual[item.status] += 1
  }
  for (const key of ['completed', 'inProgress', 'pending'] as const) {
    if (snapshot.counts[key] !== actual[key]) {
      context.addIssue({
        code: 'custom', path: ['counts', key],
        message: `CodeM todo snapshot counts.${key} does not match items`,
      })
    }
  }
}

function todoDependencyCycle(items: readonly TodoItem[]): boolean {
  const dependencies = new Map(items.map((item) => [item.id, item.blockedBy]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency) && visit(dependency)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return items.some((item) => visit(item.id))
}

function nonEmptyString(message: string): z.ZodString {
  return z.string().refine((value) => value.trim().length > 0, { error: message })
}
