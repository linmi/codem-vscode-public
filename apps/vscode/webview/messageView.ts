import { toolPresentation } from "./toolPresentation.ts"
import type { ActivityStatus, ChatMessage } from "../src/messages.ts"
import { uiIcon } from "../src/uiIcons.ts"
import { renderMarkdown } from "./markdownView.ts"

const statusLabels: Record<ActivityStatus, string> = {
  running: "进行中", completed: "已完成", failed: "失败", declined: "已拒绝", interrupted: "已停止", incomplete: "未完成",
}

/** Keep the native details node across deltas so the reader owns its open state. */
export function createMessageView(initial: ChatMessage): { root: HTMLElement; update(message: ChatMessage): void } {
  const root = document.createElement("article")
  root.className = "message"; root.dataset.role = initial.role
  const body = document.createElement("div"); body.className = "messageBody"
  if (initial.role === "assistant" || initial.role === "reasoning") body.classList.add("chatMarkdown")
  const label = document.createElement("span")
  const badge = document.createElement("span"); badge.className = "activityStatus"
  const preview = document.createElement("span"); preview.className = "activityPreview"
  const note = document.createElement("div"); note.className = "activityNote"
  const toolMeta = document.createElement("div"); toolMeta.className = "toolMeta"
  let activityIcon: HTMLElement | null = null
  let details: HTMLDetailsElement | null = null
  let userToggled = false
  let copyText = initial.text
  if ("status" in initial) {
    root.classList.add("activityMessage")
    details = document.createElement("details")
    details.open = initial.status === "failed"
    const summary = document.createElement("summary")
    label.className = "activityTitle"
    const icon = document.createElement("span"); icon.className = "activityIcon"
    activityIcon = icon
    icon.innerHTML = uiIcon(initial.role === "reasoning" ? "thought" : "terminal")
    const chevron = document.createElement("span"); chevron.className = "activityChevron"; chevron.innerHTML = uiIcon("chevron")
    summary.append(icon, label, chevron, badge, preview)
    summary.addEventListener("click", (event) => { event.preventDefault(); userToggled = true; details!.open = !details!.open })
    details.append(summary, note, toolMeta, body); root.append(details)
  } else {
    const heading = document.createElement("h2"); heading.className = "messageLabel"
    heading.append(label); root.append(heading, body)
    const actions = document.createElement("div"); actions.className = "messageActions"
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "copyMessage"; copy.innerHTML = uiIcon("copy"); copy.setAttribute("aria-label", "复制消息"); copy.title = "复制消息"
    const feedback = document.createElement("span"); feedback.className = "copyFeedback"; feedback.setAttribute("role", "status")
    let resetCopy: ReturnType<typeof setTimeout> | undefined
    copy.addEventListener("click", async () => {
      clearTimeout(resetCopy)
      try {
        await navigator.clipboard.writeText(copyText); copy.innerHTML = uiIcon("check"); copy.setAttribute("aria-label", "已复制消息"); feedback.textContent = ""
        resetCopy = setTimeout(() => { copy.innerHTML = uiIcon("copy"); copy.setAttribute("aria-label", "复制消息") }, 2000)
      }
      catch { feedback.textContent = "复制失败，点击重试"; copy.setAttribute("aria-label", "复制失败，点击重试") }
    })
    actions.append(copy, feedback); root.append(actions)
  }
  const attachmentLabels = document.createElement("div"); attachmentLabels.className = "messageAttachments"; root.append(attachmentLabels)
  let previousText: string | null = null
  function update(message: ChatMessage): void {
    const attachments = "attachments" in message ? message.attachments : undefined
    copyText = message.text
    attachmentLabels.textContent = attachments?.map((item) => `▧ ${item.label}`).join(" · ") ?? ""
    attachmentLabels.hidden = !attachments?.length
    label.textContent = message.label + (attachments?.length ? ` · ${attachments.map((item) => item.label).join("、")}` : "")
    let text = message.text
    if ("status" in message) {
      root.dataset.status = message.status
      if (message.role === "tool") {
        const presentation = toolPresentation(message.label)
        root.dataset.tool = presentation.kind
        label.textContent = presentation.title
        activityIcon!.innerHTML = presentation.icon
        toolMeta.textContent = `${message.label} · ${statusLabels[message.status]}`
        body.setAttribute("aria-label", `${presentation.title}输出`)
      } else toolMeta.hidden = true
      if (!userToggled && details) details.open = message.status === "failed"
      badge.textContent = message.role === "reasoning" ? ({ running: "思考中", completed: "思考完成", interrupted: "思考已停止", incomplete: "思考未完成", failed: "思考失败", declined: "已拒绝" } as const)[message.status] : statusLabels[message.status]
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
      if (message.role === "assistant" || message.role === "reasoning") renderMarkdown(body, text)
      else body.textContent = text
      previousText = text
      body.scrollTop = follow ? body.scrollHeight : top
    }
  }
  update(initial)
  return { root, update }
}
