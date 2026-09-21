/**
 * VS Code 生产聊天：挂载 @codem/ui 产品壳（登录 / 欢迎 / composer），不是调试台。
 * Host 仍可下发现网 state/account 消息；此处合成共享 ChatSnapshot。
 */
import { mountCodemUi, type CodemUiHost } from "@codem/ui"
import { asSnapshot, initialSnapshot, parseUiAction, type AccountState, type ChatSnapshot } from "@codem/ui/contract"

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): Record<string, unknown> | undefined
  setState(state: Record<string, unknown>): void
}

const vscode = acquireVsCodeApi()
const root = document.getElementById("codem-root")
if (!root) throw new Error("Missing CodeM element codem-root")

const listeners = new Set<(message: Record<string, unknown>) => void>()
let account: AccountState = { status: "checking" }
let accountOpen = false
let snapshot: ChatSnapshot = initialSnapshot()
const brandMark = root.dataset.logo || null

function publish(): void {
  const next = asSnapshot({ ...snapshot, account, accountOpen, brandMark, type: "state" })
  if (!next) return
  snapshot = next
  for (const listener of listeners) listener(snapshot as unknown as Record<string, unknown>)
}

function toHostAction(action: Record<string, unknown>): Record<string, unknown> {
  if (action.type !== "send") return action
  const next: Record<string, unknown> = { type: "send", text: action.text, requestId: action.requestId }
  if (Array.isArray(action.selectionIds)) next.selectionIds = action.selectionIds
  return next
}

window.addEventListener("message", (event: MessageEvent<{ type?: string; state?: AccountState } & Record<string, unknown>>) => {
  const data = event.data
  if (!data || typeof data !== "object") return
  if (data.type === "account" && data.state) {
    account = data.state
    if (account.status !== "signedIn") accountOpen = false
    publish()
    return
  }
  if (data.type === "showAccount") {
    accountOpen = true
    publish()
    return
  }
  if (data.type === "state") {
    const next = asSnapshot({ ...data, account, accountOpen, brandMark })
    if (next) {
      snapshot = next
      for (const listener of listeners) listener(snapshot as unknown as Record<string, unknown>)
    }
  }
})

const host: CodemUiHost = {
  postAction(action) {
    vscode.postMessage(toHostAction(parseUiAction(action)))
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getState() {
    const persisted = vscode.getState() ?? {}
    return { ...snapshot, account, accountOpen, brandMark, draft: persisted.draft ?? "" }
  },
  setState(state) {
    vscode.setState({ draft: String(state.draft ?? "") })
  },
}

mountCodemUi(root, host)
