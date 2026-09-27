import { setNonce } from "get-nonce"
import { mountCodemUi } from "@codem/ui"
import type { CodemUiHost, HostDraftCommand } from "@codem/ui"
import { VscodeHostBridge, vscodeTheme } from "./host/vscodeHostBridge.ts"

/** 页面自己保存的草稿：当前会话的草稿和界面交来的各会话草稿（原样保存，界面负责校验）。 */
interface SavedDraft { draft?: string; sessions?: unknown }

declare function acquireVsCodeApi(): {
  postMessage(message: Record<string, unknown>): void
  getState(): SavedDraft | undefined
  setState(state: SavedDraft): void
}

const vscode = acquireVsCodeApi()
const root = document.getElementById("codem-root")
if (!root) throw new Error("Missing CodeM root")
const script = document.querySelector<HTMLScriptElement>("script[nonce]")
if (script?.nonce) setNonce(script.nonce)

const bridge = new VscodeHostBridge()
bridge.setBrand(root.dataset.logo ?? null)
bridge.setTheme(vscodeTheme(document.body.classList))
const listeners = new Set<(message: Record<string, unknown>) => void>()
const draftListeners = new Set<(command: HostDraftCommand) => void>()
// 最近一次与 Host 一致的草稿；界面保存的值与之相同就不回发，Host 下发的草稿因此不会被回显。
let lastPosted = ""
let lastSessions = JSON.stringify(vscode.getState()?.sessions ?? null)
let lastDraft: HostDraftCommand | null = null

function emit(update: NonNullable<ReturnType<VscodeHostBridge["receive"]>>): void {
  if (update.draft) {
    lastDraft = update.draft
    lastPosted = update.draft.text
    if (update.draft.sessions !== undefined) lastSessions = JSON.stringify(update.draft.sessions)
    for (const listener of draftListeners) listener(update.draft)
  }
  if (update.snapshot) for (const listener of listeners) listener(update.snapshot as unknown as Record<string, unknown>)
  if (update.reply) vscode.postMessage(update.reply)
}

window.addEventListener("message", (event: MessageEvent) => {
  const update = bridge.receive(event.data)
  if (update) emit(update)
})

// VS Code 切换主题时只改 body class，不会发来任何 Host 消息。
new MutationObserver(() => {
  const update = bridge.setTheme(vscodeTheme(document.body.classList))
  if (update) emit(update)
}).observe(document.body, { attributes: true, attributeFilter: ["class"] })

const host: CodemUiHost = {
  surface: root.dataset.surface === "editor" ? "editor" : "sidebar",
  postAction(action) {
    vscode.postMessage(bridge.toHost(action))
  },
  subscribe(listener) {
    listeners.add(listener)
    listener(bridge.snapshot() as unknown as Record<string, unknown>)
    return () => listeners.delete(listener)
  },
  subscribeDraft(listener) {
    draftListeners.add(listener)
    if (lastDraft) listener(lastDraft)
    return () => draftListeners.delete(listener)
  },
  getState() {
    const saved = vscode.getState()
    return { ...bridge.snapshot(), draft: saved?.draft ?? "", sessions: saved?.sessions ?? null }
  },
  setState(state) {
    const text = typeof state.draft === "string" ? state.draft : ""
    vscode.setState({ draft: text, sessions: state.sessions })
    bridge.rememberDraft(text)
    // 各会话草稿只在切换会话时变化，这时才随草稿一并交给 Host，平时输入只发当前草稿。
    const sessions = JSON.stringify(state.sessions ?? null)
    if (text === lastPosted && sessions === lastSessions) return
    const value: Record<string, unknown> = { draft: text }
    if (sessions !== lastSessions) value.sessions = state.sessions ?? null
    lastPosted = text; lastSessions = sessions
    vscode.postMessage({ type: "composerChanged", value })
  },
}

mountCodemUi(root, host)
// focusedView 在焦点进入侧栏 Webview 内部时不成立；聊天内快捷键改由页面上报的焦点决定。
const reportFocus = (focused: boolean) => vscode.postMessage({ type: "chatFocus", focused })
window.addEventListener("focus", () => reportFocus(true))
window.addEventListener("blur", () => reportFocus(false))
if (document.hasFocus()) reportFocus(true)
const saved = vscode.getState()
vscode.postMessage({ type: "composerRestore", value: saved?.sessions == null ? { draft: saved?.draft ?? "" } : { draft: saved.draft ?? "", sessions: saved.sessions } })
