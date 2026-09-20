import { useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CheckIcon, ChevronDownIcon, CircleIcon, CircleDotIcon, ListChecksIcon, MinusIcon } from "lucide-react"
import type { ActivityMessage, ActivityStatus } from "../../src/shared/messages.ts"
import { taskRowPresentation, type TaskProgressDetails } from "../../src/shared/taskProgress.ts"
import { Button } from "../components/ui/button.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible.tsx"

const outcomes: Record<ActivityStatus, string> = { running: "正在提交", completed: "已保存", failed: "保存失败", declined: "已拒绝", interrupted: "已停止", incomplete: "结果未确认" }
function TaskProgress({ message, details }: { message: ActivityMessage; details: TaskProgressDetails | null }) {
  const [open, setOpen] = useState(false)
  const applied = message.status === "completed"
  const title = details?.title ?? (message.label === "task_create" ? "创建任务清单" : "更新任务进展")
  return <section className="taskProgressCard" aria-label={title} data-outcome={message.status}>
    <header className="taskProgressHeading"><ListChecksIcon aria-hidden="true" /><strong>{title}</strong><span className="taskProgressOutcome" role="status">{outcomes[message.status]}</span></header>
    {details ? <>
      <p className="taskProgressScope">{details.operation === "create" ? "本次创建" : "本次更新"} · {details.rows.length} 项{!applied && " · 以下为请求内容，尚未确认生效"}</p>
      <ol className="taskProgressRows">{details.rows.map((row, index) => {
        const view = taskRowPresentation(row, applied)
        const Icon = view.status === "completed" ? CheckIcon : view.status === "in_progress" ? CircleDotIcon : view.status === "deleted" ? MinusIcon : CircleIcon
        return <li key={`${row.id ?? "new"}:${index}`} data-task-state={view.status}>
          <Icon aria-hidden="true" /><div className="taskProgressContent"><span>{view.content}</span>{row.changes.filter(change => change !== `进行时：${view.content}`).map((change, i) => <small key={i}>{change}</small>)}</div><span className="taskProgressState">{view.label}</span>
        </li>
      })}</ol>
      {details.fields.map(field => <p className="taskProgressScope" key={field.label}>{field.label}：{field.value}</p>)}
    </> : <p className="taskProgressScope">未提供可识别的任务清单，可展开查看调用结果。</p>}
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="taskProgressDisclosure"><ChevronDownIcon aria-hidden="true" />调用详情</Button></CollapsibleTrigger>
      <CollapsibleContent className="taskProgressOutput">{message.summary && message.summary !== message.text && <p>{message.summary}</p>}<pre>{message.text || (message.status === "running" ? "等待工具结果…" : "未提供文本结果。")}</pre></CollapsibleContent>
    </Collapsible>
  </section>
}

/** The message owns data; this root retains only the reader's disclosure choice. */
export function createTaskProgress(initial: ActivityMessage) {
  const root = document.createElement("article")
  root.className = "message taskProgressMessage"; root.dataset.role = "tool"; root.dataset.tool = "task"
  const reactRoot = createRoot(root)
  let previous = ""
  const update = (message: ActivityMessage) => {
    const key = JSON.stringify(message)
    if (key === previous) return
    previous = key; root.dataset.status = message.status
    const details = message.details?.kind === "task" ? message.details : null
    flushSync(() => reactRoot.render(<TaskProgress message={message} details={details} />))
  }
  update(initial)
  return { root, update, dispose: () => reactRoot.unmount() }
}
