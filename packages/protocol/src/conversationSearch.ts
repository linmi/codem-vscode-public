/** Display-only search state; history cursors and filesystem paths remain in Host. */
export interface ConversationSearchView {
  open: boolean
  status: "idle" | "loading" | "ready" | "error"
  query: string
  hits: readonly { id: string; role: "user" | "assistant"; excerpt: string }[]
  truncated: boolean
  error: string | null
  target: string | null
  historical: boolean
}
