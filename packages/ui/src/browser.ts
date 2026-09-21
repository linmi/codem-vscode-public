import { mountCodemUi, type CodemUiHost } from "./index.ts"

const listeners = new Set<(message: Record<string, unknown>) => void>()
let persisted: Record<string, unknown> = { type: "state", phase: "disconnected" }

const host: CodemUiHost = {
  postAction(action) {
    window.parent?.postMessage({ source: "codem-ui", action }, "*")
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getState() {
    return persisted
  },
  setState(state) {
    persisted = { ...persisted, ...state }
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
