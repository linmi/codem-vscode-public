import type { ActivityStatus, ChatMessage } from "../src/messages.ts"

const statusLabels: Record<ActivityStatus, string> = {
  running: "进行中", completed: "已完成", failed: "失败", declined: "已拒绝", interrupted: "已停止", incomplete: "未完成",
}

// Model and tool content is always text, including incomplete code fences.
function renderText(target: HTMLElement, text: string): void {
  target.replaceChildren()
  const fence = /```[^\n]*\n([\s\S]*?)(?:```|$)/g
  let end = 0
  for (const match of text.matchAll(fence)) {
    target.append(document.createTextNode(text.slice(end, match.index)))
    const pre = document.createElement("pre")
    const code = document.createElement("code")
    code.textContent = match[1] ?? ""
    pre.append(code); target.append(pre)
    end = match.index + match[0].length
  }
  target.append(document.createTextNode(text.slice(end)))
}

/** Keep the native details node across deltas so the reader owns its open state. */
export function createMessageView(initial: ChatMessage): { root: HTMLElement; update(message: ChatMessage): void } {
  const root = document.createElement("article")
  root.className = "message"; root.dataset.role = initial.role
  const body = document.createElement("div"); body.className = "messageBody"
  const label = document.createElement("span")
  const badge = document.createElement("span"); badge.className = "activityStatus"
  const preview = document.createElement("span"); preview.className = "activityPreview"
  const note = document.createElement("div"); note.className = "activityNote"
  if ("status" in initial) {
    root.classList.add("activityMessage")
    const details = document.createElement("details")
    details.open = initial.status === "running" || initial.status === "failed"
    const summary = document.createElement("summary")
    label.className = "activityTitle"
    summary.append(label, badge, preview)
    details.append(summary, note, body); root.append(details)
  } else {
    const heading = document.createElement("h2"); heading.className = "messageLabel"
    heading.append(label); root.append(heading, body)
  }
  let previousText: string | null = null
  function update(message: ChatMessage): void {
    const attachments = "attachments" in message ? message.attachments : undefined
    label.textContent = message.label + (attachments?.length ? ` · ${attachments.map((item) => item.label).join("、")}` : "")
    let text = message.text
    if ("status" in message) {
      root.dataset.status = message.status
      badge.textContent = message.role === "reasoning" && message.status === "running" ? "思考中" : statusLabels[message.status]
      note.textContent = message.summary
      note.hidden = !message.summary || message.summary === message.text
      const empty = message.status === "running" ? (message.role === "reasoning" ? "正在思考…" : "等待工具输出…") : message.status === "incomplete" ? "未收到完成结果。" : message.role === "reasoning" ? "Core 未提供可显示的思考内容。" : "无文本输出。"
      text ||= empty
      body.classList.toggle("emptyOutput", !message.text)
      preview.textContent = (message.summary || message.text || empty).replace(/\s+/g, " ").slice(0, 180)
    }
    if (text !== previousText) {
      const top = body.scrollTop
      const follow = body.scrollHeight - top - body.clientHeight < 40
      renderText(body, text); previousText = text
      body.scrollTop = follow ? body.scrollHeight : top
    }
  }
  update(initial)
  return { root, update }
}
