import type { ToolDetails } from "../shared/messages.ts"

type TaskStatus = "pending" | "in_progress" | "completed"
interface TaskProgressRow { id: string | null; content: string | null; activeForm: string | null; status: TaskStatus | null; deleted: boolean; changes: readonly string[] }
function details(rows: TaskProgressRow[], fields: { label: string; value: string }[]): ToolDetails {
  for (const row of rows) {
    fields.push({ label: "任务", value: [row.id, row.content].filter(Boolean).join(" · ") })
    if (row.deleted) fields.push({ label: "请求操作", value: "移除任务" })
    else if (row.status) fields.push({ label: "期望状态", value: ({ pending: "待执行", in_progress: "进行中", completed: "已完成" })[row.status] })
    if (row.activeForm) fields.push({ label: "进行时文案", value: row.activeForm })
    for (const change of row.changes) fields.push({ label: "请求变更", value: change })
  }
  return { kind: "task", fields, code: null }
}

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, 8000) : null
const id = (value: unknown): string | null => typeof value === "string" && /^t-[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null
const ids = (value: unknown): string[] | null => Array.isArray(value) && value.every(entry => id(entry)) ? value as string[] : null

/** Core 0.8.44 task inputs; project only documented fields, never arbitrary arguments. */
export function projectTaskDetails(name: "task_create" | "task_update", value: Record<string, unknown>): ToolDetails | null {
  const rows: TaskProgressRow[] = []
  const fields: { label: string; value: string }[] = []
  if (name === "task_create") {
    const title = text(value.summary)
    if (!title || !Array.isArray(value.contents) || !value.contents.length) return null
    for (const entry of value.contents) {
      const item = record(entry)
      const content = text(item ? item.content : entry)
      if (!content || (item?.activeForm !== undefined && typeof item.activeForm !== "string")) return null
      rows.push({ id: null, content, activeForm: item ? text(item.activeForm) : null, status: "pending", deleted: false, changes: [] })
    }
    if (value.replace !== undefined) {
      const replaced = ids(value.replace)
      if (!replaced) return null
      if (replaced.length) fields.push({ label: "替换任务", value: replaced.join("、") })
    }
    return details(rows, [{ label: "目标", value: title }, { label: "任务数量", value: `${rows.length} 项` }, ...fields])
  }
  // Core explicitly accepts both a batch wrapper and one update object.
  const updates = value.updates === undefined ? [value] : value.updates
  if (!Array.isArray(updates) || !updates.length) return null
  for (const entry of updates) {
    const item = record(entry)
    const taskId = item && id(item.id)
    if (!item || !taskId || (item.delete !== undefined && typeof item.delete !== "boolean")) return null
    if (item.delete === true) { rows.push({ id: taskId, content: null, activeForm: null, status: null, deleted: true, changes: [] }); continue }
    if (item.status !== undefined && !["pending", "in_progress", "completed"].includes(String(item.status))) return null
    if (item.content !== undefined && !text(item.content)) return null
    if (item.activeForm !== undefined && typeof item.activeForm !== "string") return null
    const changes: string[] = []
    for (const [key, label] of [["addBlockedBy", "等待"], ["removeBlockedBy", "解除依赖"]] as const) {
      if (item[key] === undefined) continue
      const dependencies = ids(item[key])
      if (!dependencies) return null
      if (dependencies.length) changes.push(`${label}：${dependencies.join("、")}`)
    }
    if (item.activeForm !== undefined) changes.push(text(item.activeForm) ? `进行时：${text(item.activeForm)}` : "清除进行时文案")
    if (!["status", "content", "activeForm", "addBlockedBy", "removeBlockedBy"].some(key => item[key] !== undefined)) return null
    rows.push({ id: taskId, content: text(item.content), activeForm: text(item.activeForm), status: (item.status as TaskStatus | undefined) ?? null, deleted: false, changes })
  }
  return details(rows, [{ label: "更新数量", value: `${rows.length} 项` }])
}
