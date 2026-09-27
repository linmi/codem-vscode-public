export type HistoryAction =
  | { type: "showHistory" | "closeHistory" | "refreshHistory" | "moreThreads" | "olderMessages" | "reloadHistory" }
  | { type: "resumeThread"; threadId: string }

export interface HistoryEntry {
  id: string
  title: string
  startedAt: string
  turnCount: number
  archived: boolean
}

export interface HistoryList {
  open: boolean
  loading: boolean
  entries: readonly HistoryEntry[]
  hasMore: boolean
  error: string | null
}

export function emptyHistoryList(): HistoryList {
  return { open: false, loading: false, entries: [], hasMore: false, error: null }
}

/** A conversation left running in the background when the chat switched away; ended ones stay until viewed. */
export type LiveSessionStatus = "running" | "awaitingApproval" | "completed" | "stopped" | "failed"
export interface LiveSessionView {
  id: string
  title: string
  status: LiveSessionStatus
}
