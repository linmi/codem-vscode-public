import { turnChanges } from "../src/turnChanges.ts"
import { createTurnChanges } from "./components/turnChanges.tsx"
import { elapsedTime } from "./elapsedTime.ts"
import type { ChatMessage, ChatPhase, TurnTiming, DiffView, ViewAction } from "../src/messages.ts"
import { timelineGroups } from "../src/timelineGroups.ts"
import { uiIcon } from "../src/uiIcons.ts"

/** Reuse disclosures for adjacent execution records without moving visible replies. */
export function createWorkGroups(post: (action: ViewAction) => void) {
  const changeViews = new Map<string, { root: HTMLElement; view: ReturnType<typeof createTurnChanges> }>()
  const groups = new Map<string, { root: HTMLDetailsElement; summary: HTMLElement; content: HTMLElement; touched: boolean; label: HTMLElement; timer: ReturnType<typeof setInterval> | null }>()
  return (messages: readonly ChatMessage[], node: (id: string) => HTMLElement, phase: ChatPhase, timings: readonly TurnTiming[], diffs: readonly DiffView[]): HTMLElement[] => {
    const result: HTMLElement[] = []
    const alive = new Set<string>()
    let lastActivityId: string | null = null
    const lastActivityByTurn = new Map<string, string>()
    for (const message of messages) {
      if (message.role === "user") lastActivityId = null
      else if (message.role === "tool" || message.role === "reasoning") {
        lastActivityId = message.id
        if (message.turnId) lastActivityByTurn.set(message.turnId, message.id)
      }
    }
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
      const latestResponse = work.some(message => message.id === lastActivityId)
      const running = (latestResponse && (phase === "running" || phase === "stopping")) || work.some(m => "status" in m && (m.status === "running"))
      const failed = work.some(m => "status" in m && (m.status === "failed" || m.status === "incomplete"))
      const interrupted = work.some(m => "status" in m && (m.status === "interrupted" || m.status === "declined"))
      group.root.dataset.state = running ? "running" : failed ? "failed" : interrupted ? "interrupted" : "completed"
      if (!group.touched) group.root.open = running || failed
      const label = running ? (phase === "stopping" ? "正在停止" : "正在处理") : failed ? "处理需要关注" : interrupted ? "已停止或拒绝" : "已处理"
      if (group.timer) clearInterval(group.timer)
      group.timer = null
      // A split response still has one Core turn duration, shown only on its last execution group.
      const timing = timings.find(timing => work.some(message => message.id === lastActivityByTurn.get(timing.turnId)))
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
    const changes = turnChanges(messages, diffs)
    for (const [id, entry] of changeViews) if (!changes.some(change => change.turnId === id)) { entry.view.dispose(); entry.root.remove(); changeViews.delete(id) }
    for (const change of changes) {
      let entry = changeViews.get(change.turnId)
      if (!entry) {
        const root = document.createElement("div")
        entry = { root, view: createTurnChanges(root, post) }
        changeViews.set(change.turnId, entry)
      }
      entry.view.update(change)
      const anchor = change.afterMessageId ? node(change.afterMessageId) : null
      const index = anchor ? result.findIndex(root => root === anchor || root.contains(anchor)) : -1
      if (index < 0) result.push(entry.root)
      else result.splice(index + 1, 0, entry.root)
    }
    return result
  }
}
