import type { ActivityMessage, ActivityStatus, ChatSnapshot } from "../src/shared/messages.ts"
import { projectTaskDetails } from "../src/chat/taskDetails.ts"

const create = projectTaskDetails("task_create", { summary: "完善登录与错误恢复", contents: ["核对接口与现有状态", { content: "实现登录页面", activeForm: "正在实现登录页面" }, "验证键盘操作和失败恢复"] })!
const update = projectTaskDetails("task_update", { updates: [{ id: "t-inspect", content: "核对接口与现有状态", status: "completed" }, { id: "t-build", content: "实现登录页面", activeForm: "正在实现登录页面", status: "in_progress" }, { id: "t-check", content: "验证键盘操作和失败恢复", status: "pending", addBlockedBy: ["t-build"] }] })!
export const taskProgressScenarios = [
  ["taskProgress", "工具", "任务清单 · 创建与进展"],
  ["taskProgressFailure", "工具", "任务清单 · 失败与未确认"],
] as const
export function applyTaskProgressScenario(state: ChatSnapshot, scenario: string) {
  if (!taskProgressScenarios.some(([id]) => id === scenario)) return
  const message = (id: string, label: string, details: ActivityMessage["details"], status: ActivityStatus): ActivityMessage => ({ id, role: "tool", label, details, turnId: "task-turn", summary: "", status, text: status === "failed" ? "任务更新失败：未知任务 ID。" : "模拟工具调用结果。" })
  state.phase = "running"
  state.messages = [state.messages[0]!, message("task-create", "task_create", create, "completed"), message("task-update", "task_update", update, "completed")]
  if (scenario === "taskProgressFailure") state.messages = [state.messages[0]!, ...(["running", "failed", "declined", "interrupted", "incomplete"] as const).map((status, i) => message(`task-${i}`, "task_update", projectTaskDetails("task_update", { id: "t-check", content: "验证键盘操作和失败恢复", status: "completed" })!, status))]
}
