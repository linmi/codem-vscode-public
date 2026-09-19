import { installFileMentions } from "./fileMentions.ts"
import { installComposerCommands } from "./composerCommands.ts"
import { attachmentCard, configureImageLoader } from "./attachmentView.ts"
import { createWorkGroups } from "./workGroups.ts"
import { createPanelView } from "./panelView.ts"
import type { PanelMessage } from "../src/panelTypes.ts"
import { initialSnapshot, isBusy, type ImageResult, type FileSearchResult, type FileSelected, type ChatSnapshot, type SendResult, type ViewAction } from "../src/messages.ts"
import { ComposerSubmission } from "./composerSubmission.ts"

import { createMessageView } from "./messageView.ts"
import { createHistoryView } from "./historyView.ts"

declare function acquireVsCodeApi(): { postMessage(message: ViewAction): void; getState(): { draft?: string } | undefined; setState(state: { draft: string }): void }
const vscode = acquireVsCodeApi()
function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing CodeM element ${id}`)
  return found as T
}
const prompt = element<HTMLTextAreaElement>("prompt")
const send = element<HTMLButtonElement>("send")
const stop = element<HTMLButtonElement>("stop")
const connect = element<HTMLButtonElement>("connect")
const signIn = element<HTMLButtonElement>("signIn")
const newChat = element<HTMLButtonElement>("newChat")
const scroller = element("scrollArea")
const messages = element("messages")
const jumpLatest = element<HTMLButtonElement>("jumpLatest")
const resources = element("activityPanel")
const resourceTabs = [...document.querySelectorAll<HTMLButtonElement>(".resourceTabs [role=tab]")]
function selectResourceTab(selected: HTMLButtonElement): void {
  for (const tab of resourceTabs) { const active = tab === selected; tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1; element(tab.getAttribute("aria-controls")!).hidden = !active }
}
for (const [index, tab] of resourceTabs.entries()) {
  tab.addEventListener("click", () => selectResourceTab(tab))
  tab.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const next = resourceTabs[(index + (event.key === "ArrowRight" ? 1 : resourceTabs.length - 1)) % resourceTabs.length]!; selectResourceTab(next); next.focus() }
  })
}
const toggleResources = element<HTMLButtonElement>("toggleResources")
function showResources(open: boolean): void {
  resources.hidden = !open
  toggleResources.setAttribute("aria-expanded", String(open))
  if (open) element("closeResources").focus()
  else toggleResources.focus()
}
toggleResources.addEventListener("click", () => showResources(resources.hasAttribute("hidden")))
element("closeResources").addEventListener("click", () => showResources(false))
resources.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); showResources(false) } })
function updateJump(): void { jumpLatest.hidden = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 70 }
scroller.addEventListener("scroll", updateJump, { passive: true })
jumpLatest.addEventListener("click", () => { scroller.scrollTop = scroller.scrollHeight; updateJump() })
const headerActions = document.querySelector<HTMLElement>(".headerActions")
if (!headerActions) throw new Error("Missing CodeM header actions")
const renderHistory = createHistoryView(headerActions, scroller, post)
const renderWorkGroups = createWorkGroups()
const nodes = new Map<string, ReturnType<typeof createMessageView>>()
let state: ChatSnapshot = initialSnapshot()
const imageRequests = new Map<string, (preview: import("../src/messages.ts").AttachmentView["preview"]) => void>()
configureImageLoader(id => new Promise(resolve => {
  const timer = setTimeout(() => { imageRequests.delete(id); resolve({ kind: "unavailable", reason: "图片加载超时，请重试。" }) }, 30000)
  const existing = imageRequests.get(id)
  imageRequests.set(id, preview => { clearTimeout(timer); existing?.(preview); resolve(preview) })
  if (!existing) post({ type: "loadImage", id })
}))
const submission = new ComposerSubmission()
const panels = createPanelView(post, () => saveDraft())
prompt.value = vscode.getState()?.draft ?? ""
let measuredPrompt = ""
let measuredWidth = -1
function fitPrompt(): void {
  const width = prompt.clientWidth
  if (prompt.value === measuredPrompt && width === measuredWidth) return
  measuredPrompt = prompt.value; measuredWidth = width
  prompt.style.height = "auto"
  prompt.style.height = `${Math.min(220, Math.max(59, prompt.scrollHeight))}px`
}
new ResizeObserver(fitPrompt).observe(prompt)

function post(action: ViewAction): void { vscode.postMessage(action) }
function saveDraft(): void {
  element("workingRow").hidden = !["sending", "running", "stopping"].includes(state.phase)
  element("workingLabel").textContent = panels.locked() ? "等待你的回复…" : state.phase === "sending" ? "正在发送…" : state.phase === "stopping" ? "正在停止…" : "正在思考与处理…"
  vscode.setState({ draft: prompt.value })
  fitPrompt()
  prompt.disabled = panels.locked()
  send.disabled = state.phase !== "ready" || !prompt.value.trim() || submission.busy || panels.locked()
}
function submit(): void {
  if (send.disabled) return
  const requestId = crypto.randomUUID()
  if (!submission.begin(requestId)) return
  post({ type: "send", text: prompt.value, requestId })
  saveDraft()
}
element<HTMLFormElement>("composer").addEventListener("submit", (event) => { event.preventDefault(); submit() })
prompt.addEventListener("input", () => { submission.edited(); saveDraft() })
prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit() }
})
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-prompt]")) {
  button.addEventListener("click", () => { prompt.value = button.dataset.prompt ?? ""; submission.edited(); saveDraft(); prompt.focus() })
}
connect.addEventListener("click", () => post({ type: "connect" }))
signIn.addEventListener("click", () => post({ type: "signIn" }))
newChat.addEventListener("click", () => post({ type: "newChat" }))
stop.addEventListener("click", () => post({ type: "stop" }))
element("showOutput").addEventListener("click", () => post({ type: "showOutput" }))

const configurationActions = ["selectModel", "selectEffort", "selectPermission", "selectWorkMode", "manageMcp", "refreshTools", "addAttachment"] as const
for (const type of configurationActions) element(type).addEventListener("click", () => post({ type }))
for (const type of ["refreshBackground", "cleanBackground"] as const) element(type).addEventListener("click", () => post({ type }))
function button(label: string, action: ViewAction, disabled = false): HTMLButtonElement {
  const node = document.createElement("button")
  node.type = "button"; node.textContent = label; node.disabled = disabled
  node.addEventListener("click", () => post(action))
  return node
}
let resourcesKey = ""
function renderResources(): void {
  const ready = state.phase === "ready" && !state.backgroundBusy
  for (const type of configurationActions) element<HTMLButtonElement>(type).disabled = !ready
  element("selectEffort").setAttribute("aria-label", `思考强度：${state.effort}`)
  element("selectEffort").title = `思考强度：${state.effort}`
  element("selectWorkMode").textContent = state.workMode === "plan" ? "Plan" : "Agent"
  const permission = element("selectPermission")
  permission.title = { default: "默认权限", auto: "自动审批", yolo: "完全访问" }[state.permission]
  permission.setAttribute("aria-label", `权限模式：${permission.title}`)
  permission.dataset.mode = state.permission
  const blocked = state.backgroundBusy || state.phase === "disconnected" || state.phase === "connecting" || state.phase === "configuring"
  const nextKey = JSON.stringify([state.attachments, state.diffs, state.background, state.backgroundTasks, state.mcpNames, state.tools])
  // Streaming deltas and refresh acknowledgements must not replace focused resource buttons.
  if (nextKey !== resourcesKey) {
    resourcesKey = nextKey
  const attachments = element("attachments")
  attachments.replaceChildren(...state.attachments.map(item => attachmentCard(item, () => post({ type: "removeAttachment", id: item.id }))))
  const diffs = element("diffs")
  diffs.replaceChildren(...state.diffs.map((diff) => {
    const row = document.createElement("div"); row.className = "resourceRow"
    const title = document.createElement("span"); title.textContent = `${diff.label} +${diff.added} −${diff.removed}${diff.preview === "complete" ? "" : ` · ${{ partial: "部分差异", "raw-partial": "部分差异", binary: "二进制", omitted: "无预览" }[diff.preview] ?? "差异"}`}`
    row.append(title, button("查看差异", { type: "openDiff", id: diff.id }), button("打开文件", { type: "openChangedFile", id: diff.id }))
    return row
  }))
  if (!state.diffs.length) diffs.textContent = "尚无文件差异"
  const background = element("background")
  background.replaceChildren(...state.background.map((terminal) => {
    const row = document.createElement("div"); row.className = "resourceRow"
    const title = document.createElement("span"); title.textContent = `${terminal.label} · ${terminal.inProgress ? "运行中" : "已退出"}`
    row.append(title, button("日志", { type: "openBackgroundLog", id: terminal.id }, blocked))
    if (terminal.inProgress) row.append(button("终止", { type: "terminateBackground", id: terminal.id }, blocked))
    return row
  }))
  if (!state.background.length) background.textContent = "尚无后台进程"
  element("backgroundTasks").replaceChildren(...state.backgroundTasks.map((task) => {
    const row = document.createElement("div"); row.className = "resourceRow"
    const title = document.createElement("span"); title.textContent = `${task.label} · ${{ queued: "等待唤醒", started: "已唤醒", skipped: "已跳过", cancelled: "已取消", notFound: "已不存在", noop: "无需取消" }[task.phase]}`
    row.append(title)
    if (task.phase === "queued" || task.phase === "started") row.append(button("取消任务", { type: "cancelBackgroundTask", id: task.id }, blocked))
    return row
  }))
  element("mcpNames").textContent = state.mcpNames.length ? `已配置：${state.mcpNames.join("、")}` : "未启用额外 MCP 服务器"
  element("tools").replaceChildren(...state.tools.map(name => { const row = document.createElement("div"); row.className = "toolCatalogEntry"; row.textContent = name; return row }))
  element("filesTab").textContent = `文件${state.diffs.length ? ` · ${state.diffs.length}` : ""}`
  element("backgroundTab").textContent = `任务${state.background.length + state.backgroundTasks.length ? ` · ${state.background.length + state.backgroundTasks.length}` : ""}`
  element("toolsTab").textContent = `工具${state.tools.length ? ` · ${state.tools.length}` : ""}`
  }
  for (const node of element("attachments").querySelectorAll("button")) node.disabled = !ready
  for (const id of ["refreshBackground", "cleanBackground"]) element<HTMLButtonElement>(id).disabled = blocked
  for (const id of ["background", "backgroundTasks"]) for (const node of element(id).querySelectorAll("button")) node.disabled = blocked
}

function render(next: ChatSnapshot): void {
  const follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 70
  const anchor = state.messages[0] ? nodes.get(state.messages[0].id)?.root : undefined
  const anchorTop = anchor?.getBoundingClientRect().top ?? 0
  const oldTop = scroller.scrollTop
  const switched = state.threadId !== next.threadId
  const previousFirst = state.messages[0]?.id
  const prepended = !switched && previousFirst !== undefined && next.messages.findIndex((message) => message.id === previousFirst) > 0 && state.messages.at(-1)?.id === next.messages.at(-1)?.id
  state = next
  document.querySelector<HTMLElement>(".app")!.dataset.phase = state.phase
  const liveIds = new Set(state.messages.map((message) => message.id))
  for (const [id, node] of nodes) { if (!liveIds.has(id)) { node.root.remove(); nodes.delete(id) } }
  for (const message of state.messages) {
    let view = nodes.get(message.id)
    if (!view) { view = createMessageView(message, post); nodes.set(message.id, view); if (state.phase === "running" || state.phase === "sending") view.root.classList.add("messageEnter") }
    else view.update(message)
  }
  const timelineNodes = renderWorkGroups(state.messages, id => nodes.get(id)!.root)
  let position = messages.firstChild
  for (const root of timelineNodes) {
    if (root !== position) messages.insertBefore(root, position)
    position = root.nextSibling
  }
  while (position) { const next = position.nextSibling; position.remove(); position = next }
  renderHistory(state)
  const initializing = state.phase === "connecting"
  const restoring = state.phase === "loadingHistory"
  element("transcriptLoading").hidden = !restoring && (!initializing || state.messages.length > 0)
  element("loadingLabel").textContent = restoring ? "正在恢复会话记录…" : "正在连接并加载模型…"
  messages.setAttribute("aria-busy", String(restoring))
  element("selectModel").setAttribute("aria-busy", String(initializing))
  element("welcome").hidden = initializing || restoring || ["sending", "running", "stopping"].includes(state.phase) || state.messages.length > 0
  element("connection").hidden = state.phase !== "disconnected" && state.phase !== "connecting"
  connect.disabled = signIn.disabled = state.phase === "connecting"
  connect.textContent = state.phase === "connecting" ? "正在连接…" : "连接工作区"
  newChat.disabled = isBusy(state.phase) || state.backgroundBusy
  const generating = state.phase === "running" || state.phase === "stopping"
  stop.hidden = !generating; send.hidden = generating; stop.disabled = state.phase === "stopping"
  element("statusDot").dataset.connected = String(state.phase !== "disconnected" && state.phase !== "connecting")
  element("workspace").textContent = state.workspace ?? "未连接工作区"
  element("model").textContent = !state.model || state.model === "codem-router/auto" ? "Auto" : state.model
  element("model").title = state.model ?? "连接后使用 Core 当前模型"
  element("sessionTitle").textContent = (state.history.entries.find((entry) => entry.id === state.threadId)?.title ?? state.messages.find((message) => message.role === "user")?.text)?.slice(0, 30) ?? "新会话"
  const notice = element("notice"); notice.hidden = !state.notice; notice.textContent = state.notice ?? ""
  element("status").textContent = state.phase === "connecting" ? "正在连接 CodeM…" : state.phase === "loadingHistory" ? "正在读取历史记录…" : state.phase === "sending" ? "正在发送…" : state.phase === "running" ? "CodeM 正在处理…" : state.phase === "stopping" ? "正在停止…" : "Enter 发送 · Shift + Enter 换行"
  element("status").title = element("status").textContent ?? ""
  fileMentions.refresh()
  renderResources()
  saveDraft()
  panels.restoreFocus()
  if (prepended && anchor) scroller.scrollTop = oldTop + anchor.getBoundingClientRect().top - anchorTop
  else if (switched || follow) scroller.scrollTop = scroller.scrollHeight
  updateJump()
}

window.addEventListener("message", (event: MessageEvent<ChatSnapshot | SendResult | PanelMessage | FileSearchResult | FileSelected | ImageResult>) => {
  if (event.data?.type === "imageResult") { imageRequests.get(event.data.id)?.(event.data.preview); imageRequests.delete(event.data.id) }
  else if (event.data?.type === "fileSearchResult" || event.data?.type === "fileSelected") fileMentions.receive(event.data)
  else if (event.data?.type === "panel") panels.render(event.data.panel)
  else if (event.data?.type === "state") render(event.data)
  else if (event.data?.type === "sendResult") {
    if (submission.settle(event.data)) prompt.value = ""
    saveDraft()
  }
})
const fileMentions = installFileMentions(prompt, () => state.phase === "ready" && !panels.locked(), post)
installComposerCommands(prompt, () => state.phase === "ready" && !panels.locked(), post)
saveDraft()
post({ type: "ready" })
