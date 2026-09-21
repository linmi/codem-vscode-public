import { useId } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { CheckIcon, ChevronUpIcon, CircleDotIcon, CircleIcon, ListChecksIcon } from "lucide-react"
import type { ChatSnapshot } from "../../src/shared/messages.ts"
import { Button } from "../components/ui/button.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.tsx"

function TaskProgress({ plan }: { plan: ChatSnapshot["capabilities"]["plan"] }) {
  const titleId = useId()
  const completed = plan.filter(task => task.status === "completed").length
  return <Popover modal={false}>
    <PopoverTrigger asChild><Button className="taskProgressTrigger" variant="outline" size="sm" aria-label={`任务进展，已完成 ${completed} 项，共 ${plan.length} 项`}><ListChecksIcon aria-hidden="true" /><span>任务</span><span className="taskProgressCount">{completed} / {plan.length}</span><ChevronUpIcon aria-hidden="true" /></Button></PopoverTrigger>
    <PopoverContent className="taskProgressPopover" side="top" align="end" sideOffset={8} collisionPadding={12} aria-labelledby={titleId}>
      <header className="taskProgressHeading"><h2 id={titleId}>任务进展</h2><span>{completed} / {plan.length} 已完成</span></header>
      <ol className="taskProgressList">{plan.map((task, index) => {
        const Icon = task.status === "completed" ? CheckIcon : task.status === "in_progress" ? CircleDotIcon : CircleIcon
        const label = ({ pending: "待执行", in_progress: "进行中", completed: "已完成" } as Record<string, string>)[task.status] ?? `未知状态：${task.status}`
        return <li key={index} data-task-state={task.status}><Icon aria-hidden="true" /><span className="taskProgressText">{task.content}</span><span className="taskProgressState">{label}</span></li>
      })}</ol>
    </PopoverContent>
  </Popover>
}

/** Data stays in the Host snapshot. Popover owns only focus and open state. */
export function createTaskProgress(host: HTMLElement) {
  const root = createRoot(host, { identifierPrefix: "task-progress-" })
  return (state: ChatSnapshot) => {
    const visible = state.capabilities.plan.length > 0 && state.phase !== "loadingHistory"
    host.hidden = !visible
    flushSync(() => root.render(visible ? <TaskProgress key={JSON.stringify([state.workspace, state.space, state.threadId])} plan={state.capabilities.plan} /> : null))
  }
}
