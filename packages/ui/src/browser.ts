import { mountCodemUi, type CodemUiHost } from "./index.ts"

const listeners = new Set<(message: Record<string, unknown>) => void>()
let persisted: Record<string, unknown> = { type: "state", phase: "disconnected" }
// Tab-scoped draft survives a Webview reload; snapshots never overwrite it.
let draft = window.sessionStorage.getItem("codem.draft") ?? ""

const host: CodemUiHost = {
  postAction(action) {
    window.parent?.postMessage({ source: "codem-ui", action }, "*")
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getState() {
    return { ...persisted, draft }
  },
  setState(state) {
    if (typeof state.draft !== "string") return
    draft = state.draft
    if (draft) window.sessionStorage.setItem("codem.draft", draft)
    else window.sessionStorage.removeItem("codem.draft")
  },
}

window.__codemHostReceive = (encoded: string) => {
  const message = JSON.parse(encoded) as Record<string, unknown>
  if (message.type === "state") persisted = message
  listeners.forEach((listener) => listener(message))
}

const root = document.getElementById("codem-root")
if (root) mountCodemUi(root, host)

declare global {
  interface Window {
    __codemHostReceive?: (encoded: string) => void
  }
}
