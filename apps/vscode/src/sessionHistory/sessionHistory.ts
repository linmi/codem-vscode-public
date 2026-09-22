import { readSessionHistory, searchSessionHistory, type SessionSearchResult, type SessionHistoryPage } from "@codem/history"

export type SessionHistoryReader = (threadId: string, cursor: string | undefined, signal: AbortSignal) => Promise<SessionHistoryPage>

/** Bind filesystem access to the authenticated Host's workspace, never a webview-supplied path. */
export function createSessionHistoryReader(options: {
  cwd: string
  sessionsRoot: string
  authorize: () => Promise<void>
}): SessionHistoryReader {
  return async (threadId, cursor, signal) => {
    signal.throwIfAborted()
    await options.authorize()
    signal.throwIfAborted()
    return readSessionHistory({ sessionsRoot: options.sessionsRoot, cwd: options.cwd, threadId, cursor, signal, limit: 30 })
  }
}

export type SessionHistorySearcher = (threadId: string, query: string, signal: AbortSignal) => Promise<SessionSearchResult>
export function createSessionHistorySearcher(options: { cwd: string; sessionsRoot: string; authorize: () => Promise<void> }): SessionHistorySearcher {
  return async (threadId, query, signal) => {
    signal.throwIfAborted()
    await options.authorize()
    signal.throwIfAborted()
    return searchSessionHistory({ ...options, threadId, query, signal })
  }
}
