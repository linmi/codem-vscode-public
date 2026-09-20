import { appendContext } from "../src/editorContext.ts"
import { createResourceTools } from "./components/resourceTools.tsx"
import { createSessionCommandPanel } from "./components/sessionCommandPanel.tsx"
import { createSlashCommands } from "./components/slashCommands.tsx"
import { createComposerMode, modeLabels } from "./components/composerMode.tsx"
import { commandUnavailable, inputUnavailable, inputModes, slashQuery, type ComposerMode, type ToolsDraft, type SessionCommandId, type SessionPanelCommand } from "../src/sessionCommands.ts"
import { createCapabilityStatus } from "./components/capabilityStatus.tsx"
import { createLoadingStatus } from "./loadingStatusView.ts"
import { workingStatus } from "./workingStatus.ts"
import { uiIcon, permissionIcons } from "../src/uiIcons.ts"
import { installFileMentions } from "./fileMentions.ts"
import { attachmentCard, configureImageLoader } from "./attachmentView.ts"
import { createWorkGroups } from "./workGroups.ts"
import { createPanelView } from "./panelView.ts"
import type { PanelMessage } from "../src/panelTypes.ts"
import { initialSnapshot, isBusy, type EditorMessage, type ImageResult, type FileSearchResult, type FileSelected, type ChatSnapshot, type SendResult, type ViewAction } from "../src/messages.ts"
import { ComposerSubmission } from "./composerSubmission.ts"

import { createMessageView } from "./messageView.ts"
import { createHistoryView } from "./historyView.ts"

declare function acquireVsCodeApi(): { postMessage(message: ViewAction): void; getState(): { draft?: string; tools?: ToolsDraft } | undefined; setState(state: { draft: string; tools?: ToolsDraft }): void }
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
const standaloneActions = document.getElementById("standaloneActions")
const newChat = standaloneActions ? element<HTMLButtonElement>("newChat") : null
const scroller = element("scrollArea")
const messages = element("messages")
const jumpLatest = element<HTMLButtonElement>("jumpLatest")
function updateJump(): void { jumpLatest.hidden = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 70 }
scroller.addEventListener("scroll", updateJump, { passive: true })
jumpLatest.addEventListener("click", () => { scroller.scrollTop = scroller.scrollHeight; updateJump() })
let toolsDraft = vscode.getState()?.tools
let inputMode: ComposerMode = "message"
let sendKey = "enter"
let hostDraftReady = false
let applyingHostDraft = false
let lastDraft = ""
let messageDraft = vscode.getState()?.draft ?? ""
let inputScope = ""
let commands: ReturnType<typeof createSlashCommands> | undefined
const commandPanelHost = document.createElement("div"); document.body.append(commandPanelHost)
const commandPanels = createSessionCommandPanel(commandPanelHost, post, () => prompt.focus())
const modeHost = document.createElement("div"); element("composer").prepend(modeHost)
const renderComposerMode = createComposerMode(modeHost, () => setInputMode("message"), post)
const renderResourceTools = createResourceTools(element("resourceToolsHost"), post)
const renderHistory = createHistoryView(standaloneActions, scroller, post, prompt)
const renderCapabilityStatus = createCapabilityStatus(element("runtimeDetailsHost"))
const renderWorkGroups = createWorkGroups(post)
const nodes = new Map<string, ReturnType<typeof createMessageView>>()
let state: ChatSnapshot = initialSnapshot()
const imageRequests = new Map<string, (preview: import("../src/messages.ts").AttachmentView["preview"]) => void>()
configureImageLoader(id => new Promise(resolve => {
  const timer = setTimeout(() => { imageRequests.delete(id); resolve({ kind: "unavailable", reason: "图片加载超时，请重试。" }) }, 30000)
  const existing = imageRequests.get(id)
  imageRequests.set(id, preview => { clearTimeout(timer); existing?.(preview); resolve(preview) })
  if (!existing) post({ type: "loadImage", id })
}))
const workingIndicator = createLoadingStatus(element("workingLabel"))
const submission = new ComposerSubmission()
const panels = createPanelView(post, () => saveDraft())
prompt.value = messageDraft
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
  const status = workingStatus(state, panels.kind())
  element("workingRow").hidden = status === null
  workingIndicator.set(status?.label ?? null, status?.animate)
  if (inputMode === "message") messageDraft = prompt.value
  else toolsDraft = { scope: inputScope, mode: inputMode, text: prompt.value }
  const value = { draft: messageDraft, ...(toolsDraft ? { tools: toolsDraft } : {}) }
  vscode.setState(value)
  const encoded = JSON.stringify(value)
  if (hostDraftReady && !applyingHostDraft && encoded !== lastDraft) { lastDraft = encoded; post({ type: "composerChanged", value }) }
  fitPrompt()
  prompt.disabled = panels.locked()
  send.disabled = (!isSlashInput() && Boolean(inputUnavailable(inputMode, state))) || !prompt.value.trim() || submission.busy || panels.locked()
  const generating = state.phase === "running" || state.phase === "stopping"
  send.hidden = generating && inputMode !== "steer"
  send.setAttribute("aria-label", inputMode === "message" ? "发送消息" : inputMode === "shellCommand" ? "检查命令" : `发送${modeLabels[inputMode]}`)
  prompt.setAttribute("aria-label", inputMode === "message" ? "发送给 CodeM 的消息" : `${modeLabels[inputMode]}输入`)
  prompt.placeholder = inputMode === "message" ? "提出问题，或输入 / 选择会话操作…" : inputMode === "shellCommand" ? "输入要执行的命令…" : `输入${modeLabels[inputMode]}…`
  element("attachments").hidden = inputMode !== "message"
  renderComposerMode(inputMode, state)
}
function isSlashInput(): boolean { return inputMode !== "shellCommand" && slashQuery(prompt.value) !== null }
function setInputMode(mode: ComposerMode) {
  if (inputMode === "message") messageDraft = prompt.value
  else toolsDraft = { scope: inputScope, mode: inputMode, text: prompt.value }
  inputMode = mode
  prompt.value = mode === "message" ? messageDraft : toolsDraft?.scope === inputScope && toolsDraft.mode === mode ? toolsDraft.text : ""
  submission.edited(); saveDraft(); fileMentions.refresh(); prompt.focus()
}
function chooseCommand(id: SessionCommandId) {
  if (commandUnavailable(id, state)) return
  if (isSlashInput()) { prompt.value = ""; submission.edited(); saveDraft() }
  const mode = inputModes[id]
  if (mode) { setInputMode(mode); return }
  const action = ({ files: "addAttachment", model: "selectModel", mode: "selectWorkMode", history: "showHistory" } as const)[id as "files" | "model" | "mode" | "history"]
  if (action) post({ type: action })
  else commandPanels.open(id as SessionPanelCommand)
}
function submit(): void {
  if (document.activeElement?.closest(".slashMenu")) return
  if (isSlashInput()) { commands?.open(slashQuery(prompt.value)!); return }
  if (send.disabled) return
  const requestId = crypto.randomUUID()
  const text = prompt.value
  const mode = inputMode
  const threadId = state.threadId
  const submitInput = () => {
    if (inputMode !== mode || state.threadId !== threadId || inputUnavailable(mode, state) || !submission.begin(requestId)) return
    if (mode === "message") post({ type: "send", text, requestId })
    else if (threadId) post({ type: mode, threadId, text, requestId })
    saveDraft()
  }
  if (mode === "shellCommand") commandPanels.confirmShell(text, submitInput)
  else submitInput()
}
element<HTMLFormElement>("composer").addEventListener("submit", (event) => { event.preventDefault(); submit() })
prompt.addEventListener("input", event => {
  submission.edited(); saveDraft()
  if (!(event as InputEvent).isComposing && isSlashInput() && !panels.locked()) commands?.open(slashQuery(prompt.value)!)
})
prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && (sendKey === "enter" ? !event.ctrlKey && !event.metaKey : event.ctrlKey || event.metaKey)) { event.preventDefault(); submit() }
})
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-prompt]")) {
  button.addEventListener("click", () => { prompt.value = button.dataset.prompt ?? ""; submission.edited(); saveDraft(); prompt.focus() })
}
connect.addEventListener("click", () => post({ type: "connect" }))
signIn.addEventListener("click", () => post({ type: "signIn" }))
newChat?.addEventListener("click", () => post({ type: "newChat" }))
stop.addEventListener("click", () => post({ type: "stop" }))
if (standaloneActions) element("showOutput").addEventListener("click", () => post({ type: "showOutput" }))

const configurationActions = ["selectSpace", "selectModel", "selectEffort", "selectPermission", "selectWorkMode", "addAttachment"] as const
for (const type of configurationActions) element(type).addEventListener("click", () => post({ type }))
let attachmentsKey = ""
function renderResources(): void {
  const ready = state.phase === "ready" && !state.backgroundBusy && !state.sessionTools.busy
  for (const type of configurationActions) element<HTMLButtonElement>(type).disabled = !ready
  element("selectEffort").setAttribute("aria-label", `思考强度：${state.effort}`)
  element("selectEffort").title = `思考强度：${state.effort}`
  element("selectWorkMode").textContent = state.workMode === "plan" ? "Plan" : "Agent"
  const permission = element("selectPermission")
  permission.title = { default: "默认权限", auto: "自动审批", yolo: "完全访问" }[state.permission]
  permission.setAttribute("aria-label", `权限模式：${permission.title}`)
  permission.dataset.mode = state.permission
  permission.innerHTML = uiIcon(permissionIcons[state.permission])
  const nextKey = JSON.stringify(state.attachments)
  if (nextKey !== attachmentsKey) {
    attachmentsKey = nextKey
    element("attachments").replaceChildren(...state.attachments.map(item => attachmentCard(item, () => post({ type: "removeAttachment", id: item.id }))))
  }
  for (const node of element("attachments").querySelectorAll("button")) node.disabled = !ready
  renderResourceTools(state)
}

function render(next: ChatSnapshot): void {
  const follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 70
  const anchor = state.messages[0] ? nodes.get(state.messages[0].id)?.root : undefined
  const anchorTop = anchor?.getBoundingClientRect().top ?? 0
  const oldTop = scroller.scrollTop
  const switched = state.threadId !== next.threadId
  const previousFirst = state.messages[0]?.id
  const prepended = !switched && previousFirst !== undefined && next.messages.findIndex((message) => message.id === previousFirst) > 0 && state.messages.at(-1)?.id === next.messages.at(-1)?.id
  const nextScope = JSON.stringify([next.workspace, next.space, next.threadId])
  if (inputScope !== nextScope && inputMode !== "message") {
    inputMode = "message"; prompt.value = messageDraft; submission.reset()
  }
  inputScope = nextScope
  if (next.sessionTools.result && submission.settle({ type: "sendResult", ...next.sessionTools.result })) prompt.value = ""
  state = next
  commandPanels.update(state)
  commands?.update(state)
  document.querySelector<HTMLElement>(".app")!.dataset.phase = state.phase
  const liveIds = new Set(state.messages.map((message) => message.id))
  for (const [id, node] of nodes) { if (!liveIds.has(id)) { node.dispose(); node.root.remove(); nodes.delete(id) } }
  for (const message of state.messages) {
    let view = nodes.get(message.id)
    if (!view) { view = createMessageView(message, post); nodes.set(message.id, view); if (state.phase === "running" || state.phase === "sending") view.root.classList.add("messageEnter") }
    else view.update(message)
  }
  const timelineNodes = renderWorkGroups(state.messages, id => nodes.get(id)!.root, state.phase, state.turnTimings, state.diffs)
  let position = messages.firstChild
  for (const root of timelineNodes) {
    if (root !== position) messages.insertBefore(root, position)
    position = root.nextSibling
  }
  while (position) { const next = position.nextSibling; position.remove(); position = next }
  renderHistory(state)
  renderCapabilityStatus(state, sendKey)
  const initializing = state.phase === "connecting"
  const restoring = state.phase === "loadingHistory"
  element("transcriptLoading").hidden = !restoring && !initializing
  element("loadingLabel").textContent = restoring ? "正在恢复会话记录…" : "正在连接并加载模型…"
  messages.setAttribute("aria-busy", String(restoring))
  element("selectModel").setAttribute("aria-busy", String(initializing))
  element("welcome").hidden = initializing || restoring || ["sending", "running", "stopping"].includes(state.phase) || state.messages.length > 0
  element("connection").hidden = state.phase !== "disconnected"
  connect.disabled = signIn.disabled = state.phase === "connecting"
  if (newChat) newChat.disabled = isBusy(state.phase) || state.backgroundBusy || Boolean(state.sessionTools.busy)
  const generating = state.phase === "running" || state.phase === "stopping"
  stop.hidden = !generating; send.hidden = generating; stop.disabled = state.phase === "stopping"
  element("statusDot").dataset.connected = String(state.phase !== "disconnected" && state.phase !== "connecting")
  element("space").textContent = state.space ?? "选择空间"
  element("selectSpace").title = state.space ? `切换空间：${state.space}` : "连接后选择 CodeM 空间"
  element("workspace").textContent = state.workspace ?? "未连接工作区"
  element("model").textContent = !state.model || state.model === "codem-router/auto" ? "Auto" : state.model
  element("model").title = state.model ?? "连接后使用 Core 当前模型"
  element("sessionTitle").textContent = (state.history.entries.find((entry) => entry.id === state.threadId)?.title ?? state.messages.find((message) => message.role === "user")?.text)?.slice(0, 30) ?? "新会话"
  const notice = element("notice"); notice.hidden = !state.notice; notice.textContent = state.notice ?? ""
  element("status").textContent = state.phase === "sideQuestion" ? "正在旁路提问，输入 /ask 查看或取消…" : state.phase === "sending" ? "正在发送…" : state.phase === "running" ? "CodeM 正在处理…" : state.phase === "stopping" ? "正在停止…" : ""
  fileMentions.refresh()
  renderResources()
  saveDraft()
  panels.restoreFocus()
  if (prepended && anchor) scroller.scrollTop = oldTop + anchor.getBoundingClientRect().top - anchorTop
  else if (switched || follow) scroller.scrollTop = scroller.scrollHeight
  updateJump()
}

window.addEventListener("message", (event: MessageEvent<EditorMessage | ChatSnapshot | SendResult | PanelMessage | FileSearchResult | FileSelected | ImageResult>) => {
  if (event.data?.type === "composerDraft") {
    applyingHostDraft = true; hostDraftReady = true
    submission.reset()
    if (event.data.pendingRequestId) submission.begin(event.data.pendingRequestId)
    messageDraft = event.data.value.draft; toolsDraft = event.data.value.tools
    inputMode = "message"; prompt.value = messageDraft; saveDraft()
    lastDraft = JSON.stringify(event.data.value); applyingHostDraft = false
    if (event.data.focus) prompt.focus()
  }
  else if (event.data?.type === "appendContext") {
    let accepted = false
    try {
      const next = appendContext(inputMode === "message" ? prompt.value : messageDraft, event.data.text)
      setInputMode("message"); applyingHostDraft = true
      prompt.value = next; submission.edited(); saveDraft(); accepted = true
    } catch { /* Host reports a rejected receipt and keeps the previous draft. */ }
    finally { applyingHostDraft = false }
    const value = { draft: messageDraft, ...(toolsDraft ? { tools: toolsDraft } : {}) }
    lastDraft = JSON.stringify(value)
    post({ type: "contextAdded", id: event.data.id, value, accepted })
  }
  else if (event.data?.type === "focusComposer") prompt.focus()
  else if (event.data?.type === "editorSettings") { sendKey = event.data.sendKey; send.title = sendKey === "enter" ? "发送消息 · Enter" : "发送消息 · Ctrl / Cmd + Enter"; render(state) }
  else if (event.data?.type === "imageResult") { imageRequests.get(event.data.id)?.(event.data.preview); imageRequests.delete(event.data.id) }
  else if (event.data?.type === "fileSearchResult" || event.data?.type === "fileSelected") fileMentions.receive(event.data)
  else if (event.data?.type === "panel") panels.render(event.data.panel)
  else if (event.data?.type === "state") render(event.data)
  else if (event.data?.type === "sendResult") {
    if (submission.settle(event.data)) prompt.value = ""
    saveDraft()
  }
})
const fileMentions = installFileMentions(prompt, () => inputMode === "message" && state.phase === "ready" && !panels.locked(), post)
const commandsHost = document.createElement("span"); document.querySelector(".composerLeading")!.append(commandsHost)
commands = createSlashCommands(commandsHost, element("composer"), prompt, chooseCommand)
commands.update(state)
commandPanels.update(state)
saveDraft()
post({ type: "ready" })
post({ type: "composerRestore", value: { draft: messageDraft, ...(toolsDraft ? { tools: toolsDraft } : {}) } })
