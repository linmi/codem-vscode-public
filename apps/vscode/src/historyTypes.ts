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
