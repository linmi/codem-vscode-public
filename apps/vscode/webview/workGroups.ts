import type { ChatMessage } from "../src/messages.ts"
import { timelineGroups } from "../src/timelineGroups.ts"
import { uiIcon } from "../src/uiIcons.ts"

/** Keep a response’s execution and progress updates in one disclosure. */
export function createWorkGroups() {
  const groups = new Map<string, { root: HTMLDetailsElement; summary: HTMLElement; content: HTMLElement; touched: boolean }>()
  return (messages: readonly ChatMessage[], node: (id: string) => HTMLElement): HTMLElement[] => {
    const result: HTMLElement[] = []
    const alive = new Set<string>()
    for (const item of timelineGroups(messages)) {
      if (item.kind === "message") { result.push(node(item.message.id)); continue }
      const work = item.messages
      const id = item.id
      alive.add(id)
      let group = groups.get(id)
      if (!group) {
        const root = document.createElement("details"); root.className = "workGroup"
        const summary = document.createElement("summary")
        const content = document.createElement("div"); content.className = "workGroupContent"
        root.append(summary, content)
        group = { root, summary, content, touched: false }
        const current = group
        summary.addEventListener("click", event => { event.preventDefault(); current.touched = true; root.open = !root.open })
        groups.set(id, group)
      }
      const running = work.some(m => "status" in m && (m.status === "running"))
      const failed = work.some(m => "status" in m && (m.status === "failed" || m.status === "incomplete"))
      const interrupted = work.some(m => "status" in m && (m.status === "interrupted" || m.status === "declined"))
      group.root.dataset.state = running ? "running" : failed ? "failed" : interrupted ? "interrupted" : "completed"
      if (!group.touched) group.root.open = running || failed
      const tools = work.filter(m => m.role === "tool").length
      const thoughts = work.filter(m => m.role === "reasoning").length
      group.summary.innerHTML = uiIcon("chevron")
      const label = document.createElement("span")
      label.textContent = `${running ? "正在执行" : failed ? "执行需要关注" : interrupted ? "执行已停止或拒绝" : "执行完成"} · ${[thoughts ? `${thoughts} 段思考` : "", tools ? `${tools} 次工具调用` : ""].filter(Boolean).join(" · ")}`
      group.summary.append(label)
      let position = group.content.firstChild
      for (const message of work) {
        const child = node(message.id)
        if (child !== position) group.content.insertBefore(child, position)
        position = child.nextSibling
      }
      while (position) { const next = position.nextSibling; position.remove(); position = next }
      result.push(group.root)
    }
    for (const [id, group] of groups) if (!alive.has(id)) { group.root.remove(); groups.delete(id) }
    return result
  }
}
