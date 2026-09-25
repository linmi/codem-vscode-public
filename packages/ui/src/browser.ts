import { createBrowserHost } from "./browserHost.ts"
import { mountCodemUi } from "./index.ts"

const host = createBrowserHost((message) => window.parent?.postMessage(message, "*"), window.sessionStorage)
window.__codemHostReceive = host.receive

const root = document.getElementById("codem-root")
if (root) mountCodemUi(root, host)

declare global {
  interface Window {
    __codemHostReceive?: (encoded: string) => void
  }
}
