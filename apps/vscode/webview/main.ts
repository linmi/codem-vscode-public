import { createResourceTools } from "./resources/resourceTools.tsx"
import { createCapabilityStatus } from "./status/capabilityStatus.tsx"
import { createLoadingStatus } from "./status/loadingStatusView.ts"
import { workingStatus } from "./status/workingStatus.ts"
import { createWelcomeView } from "./status/welcomeView.tsx"
import { attachmentCard, configureImageLoader } from "./resources/attachmentView.ts"
import { createWorkGroups } from "./transcript/workGroups.ts"
import { createPanelView } from "./panels/panelView.ts"
import type { PanelMessage } from "../src/shared/panelTypes.ts"
import { initialSnapshot, isBusy, type ComposerDraft, type EditorMessage, type ImageResult, type FileSearchResult, type FileSelected, type ChatSnapshot, type SendResult, type ViewAction } from "../src/shared/messages.ts"

import { createComposerMenus } from "./composer/composerMenus.tsx"
import { createEffortSelector } from "./composer/effortSelector.tsx"
import { createComposerView } from "./composer/composerView.ts"

import { createMessageView } from "./transcript/messageView.ts"
import { createHistoryView } from "./sessionHistory/historyView.ts"

declare function acquireVsCodeApi(): { postMessage(message: ViewAction): void; getState(): Partial<ComposerDraft> | undefined; setState(state: ComposerDraft): void }
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
const renderResourceTools = createResourceTools(element("resourceToolsHost"), post)
const renderHistory = createHistoryView(standaloneActions, scroller, post, prompt)
const renderCapabilityStatus = createCapabilityStatus(element("runtimeDetailsHost"))
const renderWorkGroups = createWorkGroups(post)
const nodes = new Map<string, ReturnType<typeof createMessageView>>()
let state: ChatSnapshot = initialSnapshot()
const imageRequests = new Map<string, (preview: import("../src/shared/messages.ts").AttachmentView["preview"]) => void>()
configureImageLoader(id => new Promise(resolve => {
  const timer = setTimeout(() => { imageRequests.delete(id); resolve({ kind: "unavailable", reason: "图片加载超时，请重试。" }) }, 30000)
  const existing = imageRequests.get(id)
  imageRequests.set(id, preview => { clearTimeout(timer); existing?.(preview); resolve(preview) })
  if (!existing) post({ type: "loadImage", id })
}))
const workingIndicator = createLoadingStatus(element("workingLabel"))
const renderWelcome = createWelcomeView(element("welcome"))
const panels = createPanelView(post, () => composer.refresh())
const composer = createComposerView({ form: element<HTMLFormElement>("composer"), prompt, send, attachments: element("attachments") }, vscode, () => panels.locked(), renderWorkingStatus, menu => {
  const trigger = element(({ files: "addAttachment", model: "selectModel", mode: "selectWorkMode" })[menu])
  if (menu === "model") trigger.click()
  else trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
})

function post(action: ViewAction): void { vscode.postMessage(action) }
function renderWorkingStatus(): void {
  const status = workingStatus(state, panels.kind(), composer.pendingMessage && state.messages.at(-1)?.role === "user")
  const initializingWelcome = renderWelcome(state.phase, state.messages.length > 0, status !== null)
  element("workingRow").hidden = initializingWelcome || status === null
  workingIndicator.set(initializingWelcome ? null : status?.label ?? null, status?.animate)
}
connect.addEventListener("click", () => post({ type: "connect" }))
signIn.addEventListener("click", () => post({ type: "signIn" }))
newChat?.addEventListener("click", () => post({ type: "newChat" }))
stop.addEventListener("click", () => post({ type: "stop" }))
if (standaloneActions) element("showOutput").addEventListener("click", () => post({ type: "showOutput" }))

const renderEffort = createEffortSelector(element("effortSelector"), post)
const renderComposerMenus = createComposerMenus(element("composerMenusHost"), { attachment: element("attachmentMenu"), permission: element("permissionMenu"), workMode: element("workModeMenu"), model: element("modelMenu"), space: element("spaceMenu") }, element("modelMenu").dataset.logo!, post)
let attachmentsKey = ""
function renderResources(): void {
  const ready = ["ready", "disconnected"].includes(state.phase) && !state.backgroundBusy && !state.sessionTools.busy
  renderEffort(state)
  renderComposerMenus(state)
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
  state = next
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
  renderCapabilityStatus(state, composer.sendKey)
  const restoring = state.phase === "loadingHistory"
  element("transcriptLoading").hidden = !restoring
  messages.setAttribute("aria-busy", String(restoring))
  element("connection").hidden = state.phase !== "disconnected" || !state.notice
  connect.disabled = signIn.disabled = state.phase === "connecting"
  if (newChat) newChat.disabled = isBusy(state.phase) || state.backgroundBusy || Boolean(state.sessionTools.busy)
  const generating = state.phase === "running" || state.phase === "stopping"
  stop.hidden = !generating; stop.disabled = state.phase === "stopping"
  element("statusDot").dataset.connected = String(state.phase !== "disconnected" && state.phase !== "connecting")
  element("workspace").textContent = state.workspace ?? "未连接工作区"
  element("sessionTitle").textContent = (state.history.entries.find((entry) => entry.id === state.threadId)?.title ?? state.messages.find((message) => message.role === "user")?.text)?.slice(0, 30) ?? "新会话"
  const notice = element("notice"); notice.hidden = !state.notice; notice.textContent = state.notice ?? ""
  element("status").textContent = state.phase === "sideQuestion" ? "正在旁路提问，输入 /ask 查看或取消…" : ""
  renderResources()
  composer.update(state)
  panels.restoreFocus()
  if (prepended && anchor) scroller.scrollTop = oldTop + anchor.getBoundingClientRect().top - anchorTop
  else if (switched || follow) scroller.scrollTop = scroller.scrollHeight
  updateJump()
}

window.addEventListener("message", (event: MessageEvent<EditorMessage | ChatSnapshot | SendResult | PanelMessage | FileSearchResult | FileSelected | ImageResult>) => {
  if (event.data?.type === "codeSelection" || event.data?.type === "composerDraft" || event.data?.type === "appendContext" || event.data?.type === "focusComposer" || event.data?.type === "editorSettings" || event.data?.type === "fileSearchResult" || event.data?.type === "fileSelected" || event.data?.type === "sendResult") {
    composer.receive(event.data)
    if (event.data.type === "editorSettings") renderCapabilityStatus(state, composer.sendKey)
  }
  else if (event.data?.type === "imageResult") { imageRequests.get(event.data.id)?.(event.data.preview); imageRequests.delete(event.data.id) }
  else if (event.data?.type === "panel") panels.render(event.data.panel)
  else if (event.data?.type === "state") render(event.data)
})
composer.update(state)
post({ type: "ready" })
composer.requestRestore()
