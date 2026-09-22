import { setNonce } from "get-nonce"
import { mountCodemUi } from "@codem/ui"
import type { CodemUiHost } from "@codem/ui"
import { VscodeHostBridge } from "./host/vscodeHostBridge.ts"

declare function acquireVsCodeApi(): {
  postMessage(message: Record<string, unknown>): void
  getState(): { draft?: string } | undefined
  setState(state: { draft?: string }): void
}

const vscode = acquireVsCodeApi()
const root = document.getElementById("codem-root")
if (!root) throw new Error("Missing CodeM root")
const script = document.querySelector<HTMLScriptElement>("script[nonce]")
if (script?.nonce) setNonce(script.nonce)

const bridge = new VscodeHostBridge()
bridge.setBrand(root.dataset.logo ?? null)
const listeners = new Set<(message: Record<string, unknown>) => void>()
const draftListeners = new Set<(command: { revision: number; text: string; mode: "message" | "askSideQuestion" | "steer" | "shellCommand"; focus: boolean; pendingRequestId: string | null }) => void>()
let applyingDraft = false
let lastPosted = ""
let lastDraft: { revision: number; text: string; mode: "message" | "askSideQuestion" | "steer" | "shellCommand"; focus: boolean; pendingRequestId: string | null } | null = null

function emit(update: NonNullable<ReturnType<VscodeHostBridge["receive"]>>): void {
  if (update.draft) {
    lastDraft = update.draft
    applyingDraft = true
    for (const listener of draftListeners) listener(update.draft)
    applyingDraft = false
    lastPosted = update.draft.text
  }
  if (update.snapshot) for (const listener of listeners) listener(update.snapshot as unknown as Record<string, unknown>)
  if (update.reply) vscode.postMessage(update.reply)
}

window.addEventListener("message", (event: MessageEvent) => {
  const update = bridge.receive(event.data)
  if (update) emit(update)
})

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
    return { ...bridge.snapshot(), draft: vscode.getState()?.draft ?? "" }
  },
  setState(state) {
    const text = typeof state.draft === "string" ? state.draft : ""
    vscode.setState({ draft: text })
    bridge.rememberDraft(text)
    if (applyingDraft || text === lastPosted) return
    lastPosted = text
    vscode.postMessage({ type: "composerChanged", value: { draft: text } })
  },
}

mountCodemUi(root, host)
vscode.postMessage({ type: "composerRestore", value: { draft: vscode.getState()?.draft ?? "" } })
