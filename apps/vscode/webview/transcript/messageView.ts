import { createLoadingStatus } from "../status/loadingStatusView.ts"
import { artifactCard } from "../resources/artifactView.ts"
import { attachmentCard } from "../resources/attachmentView.ts"
import { activityTitle, toolPresentation } from "./toolPresentation.ts"
import type { ActivityStatus, ChatMessage, ViewAction } from "../../src/shared/messages.ts"
import { uiIcon } from "../../src/shared/uiIcons.ts"
import { renderMarkdown } from "./markdownView.ts"
import { createUserMessage } from "./userMessage.tsx"

const statusLabels: Record<ActivityStatus, string> = {
  running: "进行中", completed: "已完成", failed: "失败", declined: "已拒绝", interrupted: "已停止", incomplete: "未完成",
}

/** Keep the native details node across deltas so the reader owns its open state. */
export function createMessageView(initial: ChatMessage, post: (action: ViewAction) => void): { root: HTMLElement; update(message: ChatMessage): void; dispose(): void } {
  const root = document.createElement("article")
  root.className = "message"; root.dataset.role = initial.role
  const body = document.createElement("div"); body.className = "messageBody"
  const userMessage = initial.role === "user" ? createUserMessage(body) : null
  if (initial.role === "assistant" || initial.role === "reasoning") body.classList.add("chatMarkdown")
  const label = document.createElement("span")
  const badge = document.createElement("span"); badge.className = "activityStatus"
  const note = document.createElement("div"); note.className = "activityNote"
  const toolOutput = document.createElement("section"); toolOutput.className = "toolOutput"
  const toolHeading = document.createElement("div"); toolHeading.className = "toolOutputHeading"
  const inputDetails = document.createElement("div"); inputDetails.className = "toolInputCard"
  const loadingSlot = document.createElement("span"); loadingSlot.className = "activityLoading"; loadingSlot.hidden = true
  const loading = createLoadingStatus(loadingSlot)
  let inputKey = ""
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
    summary.append(icon, label, loadingSlot, chevron, badge)
    summary.addEventListener("click", (event) => { event.preventDefault(); userToggled = true; details!.open = !details!.open })
    details.append(summary, note)
    if (initial.role === "tool") {
      toolOutput.append(toolHeading, inputDetails, body)
      details.append(toolOutput)
    } else details.append(body)
    root.append(details)
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
  const artifacts = document.createElement("div"); artifacts.className = "messageArtifacts"; root.append(artifacts)
  let artifactKey = ""
  let previousText: string | null = null
  function update(message: ChatMessage): void {
    const nextArtifacts = JSON.stringify(message.artifacts ?? [])
    if (nextArtifacts !== artifactKey) { artifacts.replaceChildren(...(message.artifacts ?? []).map(item => artifactCard(item, post))); artifactKey = nextArtifacts }
    artifacts.hidden = !message.artifacts?.length
    const attachments = "attachments" in message ? message.attachments : undefined
    copyText = message.text
    if (attachmentLabels.dataset.ids !== attachments?.map(item => item.id).join(",")) {
      attachmentLabels.replaceChildren(...(attachments ?? []).map(item => attachmentCard(item)))
      attachmentLabels.dataset.ids = attachments?.map(item => item.id).join(",") ?? ""
    }
    attachmentLabels.hidden = !attachments?.length
    label.textContent = message.label + (attachments?.length ? ` · ${attachments.map((item) => item.label).join("、")}` : "")
    let text = message.text
    if ("status" in message) {
      root.dataset.status = message.status
      const nextInput = JSON.stringify(message.details ?? null)
      if (inputKey !== nextInput) {
        inputKey = nextInput; inputDetails.replaceChildren()
        inputDetails.hidden = !message.details
        if (message.details) {
          inputDetails.dataset.kind = message.details.kind
          if (message.details.code) { const command = document.createElement("pre"); command.className = "toolCommand"; command.textContent = message.details.code; inputDetails.append(command) }
          for (const field of message.details.fields.filter(field => field.value)) {
            const row = document.createElement("div"); row.className = "toolInputField"
            const label = document.createElement("span"); label.textContent = field.label
            const value = document.createElement("span"); value.textContent = field.value
            row.append(label, value); inputDetails.append(row)
          }
        }
      }
      if (message.role === "tool") {
        const presentation = toolPresentation(message.label)
        root.dataset.tool = presentation.kind
        label.textContent = activityTitle(message)
        activityIcon!.innerHTML = presentation.icon
        toolHeading.textContent = message.label === "skill" ? "技能加载结果" : message.details?.kind === "command" ? "Shell" : `${presentation.title}输出`
        toolOutput.setAttribute("aria-label", toolHeading.textContent)
        body.setAttribute("aria-label", message.label === "skill" ? "技能加载结果" : `${presentation.title}输出`)
      } else label.textContent = activityTitle(message)
      const thinking = message.role === "reasoning" && message.status === "running"
      label.hidden = thinking
      activityIcon!.hidden = thinking
      loadingSlot.hidden = !thinking
      loading.set(thinking ? label.textContent : null)
      label.title = label.textContent ?? ""
      if (!userToggled && details) details.open = message.status === "failed"
      badge.textContent = message.role === "reasoning" ? ({ running: "思考中", completed: "思考完成", interrupted: "思考已停止", incomplete: "思考未完成", failed: "思考失败", declined: "已拒绝" } as const)[message.status] : statusLabels[message.status]
      badge.hidden = message.status === "running"
      note.textContent = message.summary
      note.hidden = !message.summary.trim() || message.summary.trim() === message.text.trim() || message.summary.trim() === label.textContent?.trim()
      const empty = message.status === "running" ? (message.role === "reasoning" ? "正在思考…" : message.label === "skill" ? "正在加载技能说明…" : "等待工具输出…") : message.status === "incomplete" ? "未收到完成结果。" : message.role === "reasoning" ? "Core 未提供可显示的思考内容。" : "无文本输出。"
      text ||= empty
      body.classList.toggle("emptyOutput", !message.text)
    }
    if (text !== previousText) {
      const top = body.scrollTop
      const follow = body.scrollHeight - top - body.clientHeight < 40
      if (message.role === "assistant" || message.role === "reasoning") renderMarkdown(body, text)
      else if (userMessage) userMessage.update(text)
      else body.textContent = text
      previousText = text
      body.scrollTop = follow ? body.scrollHeight : top
    }
  }
  update(initial)
  return { root, update, dispose: () => { loading.dispose(); userMessage?.dispose() } }
}
