import { elapsedTime } from "./elapsedTime.ts"
import type { ChatMessage, ChatPhase, TurnTiming } from "../src/messages.ts"
import { timelineGroups } from "../src/timelineGroups.ts"
import { uiIcon } from "../src/uiIcons.ts"

/** Keep a response’s execution and progress updates in one disclosure. */
export function createWorkGroups() {
  const groups = new Map<string, { root: HTMLDetailsElement; summary: HTMLElement; content: HTMLElement; touched: boolean; label: HTMLElement; timer: ReturnType<typeof setInterval> | null }>()
  return (messages: readonly ChatMessage[], node: (id: string) => HTMLElement, phase: ChatPhase, timings: readonly TurnTiming[]): HTMLElement[] => {
    const result: HTMLElement[] = []
    const alive = new Set<string>()
    let lastUserIndex = -1
    messages.forEach((message, index) => { if (message.role === "user") lastUserIndex = index })
    for (const item of timelineGroups(messages)) {
      if (item.kind === "message") { result.push(node(item.message.id)); continue }
      const work = item.messages
      const id = item.id
      alive.add(id)
      let group = groups.get(id)
      if (!group) {
        const root = document.createElement("details"); root.className = "workGroup"
        const summary = document.createElement("summary")
        const chevron = document.createElement("span"); chevron.className = "workGroupChevron"
        chevron.innerHTML = uiIcon("chevron"); chevron.setAttribute("aria-hidden", "true")
        const label = document.createElement("span")
        summary.append(label, chevron)
        const content = document.createElement("div"); content.className = "workGroupContent"
        root.append(summary, content)
        group = { root, summary, content, touched: false, label, timer: null }
        const current = group
        summary.addEventListener("click", event => { event.preventDefault(); current.touched = true; root.open = !root.open })
        groups.set(id, group)
      }
      const latestResponse = messages.slice(lastUserIndex + 1).some(m => m.id === id)
      const running = (latestResponse && (phase === "running" || phase === "stopping")) || work.some(m => "status" in m && (m.status === "running"))
      const failed = work.some(m => "status" in m && (m.status === "failed" || m.status === "incomplete"))
      const interrupted = work.some(m => "status" in m && (m.status === "interrupted" || m.status === "declined"))
      group.root.dataset.state = running ? "running" : failed ? "failed" : interrupted ? "interrupted" : "completed"
      if (!group.touched) group.root.open = running || failed
      const label = running ? (phase === "stopping" ? "正在停止" : "正在处理") : failed ? "处理需要关注" : interrupted ? "已停止或拒绝" : "已处理"
      if (group.timer) clearInterval(group.timer)
      group.timer = null
      const timing = timings.find(timing => work.some(message => message.turnId === timing.turnId))
      const heading = group.label
      const updateElapsed = () => {
        const status = failed ? "处理需要关注 · " : phase === "stopping" && latestResponse ? "正在停止 · " : interrupted ? "已停止或拒绝 · " : ""
        heading.textContent = timing ? `${status}已处理 ${elapsedTime(timing, Date.now())}` : label
      }
      updateElapsed()
      if (timing?.finishedAt === null && running) group.timer = setInterval(updateElapsed, 1000)
      let position = group.content.firstChild
      for (const message of work) {
        const child = node(message.id)
        if (child !== position) group.content.insertBefore(child, position)
        position = child.nextSibling
      }
      while (position) { const next = position.nextSibling; position.remove(); position = next }
      result.push(group.root)
    }
    for (const [id, group] of groups) if (!alive.has(id)) { if (group.timer) clearInterval(group.timer); group.root.remove(); groups.delete(id) }
    return result
  }
}
