import { randomUUID } from "node:crypto"
import type { ConversationSearchView } from "@codem/protocol"
import type { SessionSearchHit } from "@codem/history"
import type { SessionHistorySearcher } from "./sessionHistory.ts"

/** Connection-local search lease and opaque hit registry. No transcript persistence. */
export class ConversationSearch {
  private abort: AbortController | null = null
  private readonly hits = new Map<string, SessionSearchHit>()
  private view: ConversationSearchView = this.empty()
  private readonly publish: () => void
  private readonly report: (operation: string, error: unknown) => void
  constructor(publish: () => void, report: (operation: string, error: unknown) => void) { this.publish = publish; this.report = report }
  private empty(): ConversationSearchView { return { open: false, status: "idle", query: "", hits: [], truncated: false, error: null, target: null, historical: false } }
  snapshot(): ConversationSearchView { return this.view }
  reset(): void { this.abort?.abort(); this.abort = null; this.hits.clear(); this.view = this.empty() }
  open(): void { this.view = { ...this.view, open: true }; this.publish() }
  close(): void {
    this.abort?.abort(); this.abort = null
    this.view = { ...this.view, open: false, status: this.view.status === "loading" ? "idle" : this.view.status }
    this.publish()
  }
  resolve(id: string): SessionSearchHit | null { return this.hits.get(id) ?? null }
  selected(messageId: string): void { this.view = { ...this.view, target: messageId, historical: true, open: false }; this.publish() }
  latest(): void { this.view = { ...this.view, target: null, historical: false }; this.publish() }
  failed(): void { this.view = { ...this.view, status: "error", error: "记录已变化或无法读取，请重新搜索。" }; this.hits.clear(); this.publish() }
  async search(read: SessionHistorySearcher, threadId: string, query: string, assertCurrent: () => void): Promise<void> {
    this.abort?.abort(); this.hits.clear()
    const abort = new AbortController(); this.abort = abort
    this.view = { ...this.view, open: true, status: "loading", query, hits: [], truncated: false, error: null }
    this.publish()
    try {
      assertCurrent()
      const result = await read(threadId, query, abort.signal)
      abort.signal.throwIfAborted(); assertCurrent()
      const hits = result.hits.map(hit => { const id = randomUUID(); this.hits.set(id, hit); return { id, role: hit.role, excerpt: hit.excerpt } })
      this.view = { ...this.view, status: "ready", hits, truncated: result.truncated }
    } catch (error) {
      if (abort.signal.aborted) return
      this.report("conversationSearch", error)
      this.view = { ...this.view, status: "error", error: "搜索失败，记录可能正在变化，请稍后重试。" }
    } finally {
      if (this.abort === abort) { this.abort = null; this.publish() }
    }
  }
}
