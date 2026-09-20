/** Display-only task mutation, shared by live and historical tool cards. */
export type TaskStatus = "pending" | "in_progress" | "completed"
export interface TaskProgressRow {
  id: string | null
  content: string | null
  activeForm: string | null
  status: TaskStatus | null
  deleted: boolean
  changes: readonly string[]
}
export interface TaskProgressDetails {
  kind: "task"
  operation: "create" | "update"
  title: string
  rows: readonly TaskProgressRow[]
  fields: readonly { label: string; value: string }[]
  code: null
}

export function taskRowPresentation(row: TaskProgressRow, applied: boolean) {
  const status = row.deleted ? "deleted" : row.status ?? "changed"
  const labels = { pending: "待执行", in_progress: "进行中", completed: "已完成", deleted: "已移除", changed: "已更新" }
  return {
    status: applied ? status : "unconfirmed",
    label: applied ? labels[status] : `拟${row.deleted ? "移除" : row.status ? `设为${labels[status]}` : "更新"}`,
    content: (applied && row.status === "in_progress" && row.activeForm) || row.content || `任务 ${row.id}`,
  }
}
