import { useId } from "react"
import { CheckIcon, ChevronUpIcon, CircleDotIcon, CircleIcon, ListChecksIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.tsx"
import type { ChatSnapshot } from "../contract.ts"

/** 对照 VS Code taskProgress。没有计划时不占位。 */
export function TaskProgress({ snapshot }: { snapshot: ChatSnapshot }) {
  const plan = snapshot.capabilities.plan
  const titleId = useId()
  if (!plan.length || snapshot.phase === "loadingHistory") return null
  const completed = plan.filter((task) => task.status === "completed").length
  const label = { pending: "待执行", in_progress: "进行中", completed: "已完成" } as Record<string, string>
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <Button className="taskProgressTrigger" variant="outline" size="sm" aria-label={`任务进展，已完成 ${completed} 项，共 ${plan.length} 项`}>
          <ListChecksIcon aria-hidden="true" /><span>任务</span><span className="taskProgressCount">{completed} / {plan.length}</span><ChevronUpIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="taskProgressPopover" side="top" align="end" sideOffset={8} collisionPadding={12} aria-labelledby={titleId}>
        <header className="taskProgressHeading"><h2 id={titleId}>任务进展</h2><span>{completed} / {plan.length} 已完成</span></header>
        <ol className="taskProgressList">
          {plan.map((task, index) => {
            const Icon = task.status === "completed" ? CheckIcon : task.status === "in_progress" ? CircleDotIcon : CircleIcon
            return (
              <li key={index} data-task-state={task.status}>
                <Icon aria-hidden="true" />
                <span className="taskProgressText">{task.content}</span>
                <span className="taskProgressState">{label[task.status] ?? `未知状态：${task.status}`}</span>
              </li>
            )
          })}
        </ol>
      </PopoverContent>
    </Popover>
  )
}
