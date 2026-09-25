import type { CodemUiHost } from "./host.ts"

/** Tab-scoped storage for the unsent draft; the page passes `window.sessionStorage`. */
export interface DraftStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface BrowserHost extends CodemUiHost {
  /** Receives one encoded Host message; installed as `window.__codemHostReceive`. */
  receive(encoded: string): void
}

const draftKey = "codem.draft"

/**
 * Page end of the JetBrains bridge. The Host publishes snapshots from one serial owner and stamps each with one
 * monotonic version. The page applies a snapshot only if it is not older than the last one applied, so a late
 * stale snapshot cannot overwrite newer state such as a completed turn. A page reload starts from scratch.
 */
export function createBrowserHost(post: (message: Record<string, unknown>) => void, drafts: DraftStorage): BrowserHost {
  const listeners = new Set<(message: Record<string, unknown>) => void>()
  let persisted: Record<string, unknown> = { type: "state", phase: "disconnected" }
  let appliedVersion = Number.NEGATIVE_INFINITY
  // Tab-scoped draft survives a Webview reload; snapshots never overwrite it.
  let draft = drafts.getItem(draftKey) ?? ""

  return {
    postAction(action) {
      post({ source: "codem-ui", action })
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
      if (draft) drafts.setItem(draftKey, draft)
      else drafts.removeItem(draftKey)
    },
    receive(encoded) {
      const message = JSON.parse(encoded) as Record<string, unknown>
      if (message.type === "state") {
        const version = message.version
        if (typeof version === "number" && Number.isFinite(version)) {
          if (version < appliedVersion) return
          appliedVersion = version
        }
        persisted = message
      }
      listeners.forEach((listener) => listener(message))
    },
  }
}
