export interface SessionSearchHit {
  readonly messageId: string
  readonly cursor: string
  readonly role: "user" | "assistant"
  readonly excerpt: string
}
export interface SessionSearchResult {
  readonly hits: readonly SessionSearchHit[]
  readonly truncated: boolean
}
