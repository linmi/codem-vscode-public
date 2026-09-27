import { randomUUID } from "node:crypto"
import type { MessageQueueView, QueuedMessageView } from "../shared/messages.ts"

/** Enough to line up follow-ups without letting one run hoard unbounded prompt text. */
export const MAX_QUEUED_MESSAGES = 20

/**
 * Messages typed while a turn runs, waiting to be sent as the next turns of the same thread.
 *
 * Owns the queued text and whether it may dispatch. The chat controller decides when a turn has
 * ended and calls `next`; a stopped or failed turn pauses the queue so nothing is sent without the
 * user asking again. The queue belongs to one Core thread: following another thread (switch, new
 * chat, close, sign-out) drops it, and nothing is persisted beyond the Host process.
 */
export class MessageQueue {
  private threadId: string | null = null
  private items: QueuedMessageView[] = []
  private paused = false

  /** Drops the queue when the current thread is no longer the one it was built for. */
  follow(threadId: string | null): void {
    if (threadId === this.threadId) return
    this.threadId = threadId
    this.items = []
    this.paused = false
  }

  add(threadId: string, text: string): boolean {
    this.follow(threadId)
    if (!text.trim() || text.length > 32_000 || this.items.length >= MAX_QUEUED_MESSAGES) return false
    this.items = [...this.items, { id: randomUUID(), text }]
    return true
  }

  edit(id: string, text: string): boolean {
    if (!text.trim() || text.length > 32_000 || !this.items.some(item => item.id === id)) return false
    this.items = this.items.map(item => item.id === id ? { ...item, text } : item)
    return true
  }

  remove(id: string): boolean {
    const before = this.items.length
    this.items = this.items.filter(item => item.id !== id)
    if (this.items.length === 0) this.paused = false
    return this.items.length !== before
  }

  /** A turn ended without completing: keep every message, send none until the user resumes. */
  pause(): void {
    if (this.items.length) this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  /** Removes and returns the head for dispatch; null while paused, empty, or bound to another thread. */
  next(threadId: string | null): QueuedMessageView | null {
    if (this.paused || threadId === null || threadId !== this.threadId) return null
    const [head, ...rest] = this.items
    if (!head) return null
    this.items = rest
    return head
  }

  /** A dispatch that Core did not accept goes back to the head, paused, so it is neither lost nor retried. */
  restore(threadId: string | null, item: QueuedMessageView): void {
    if (threadId !== this.threadId) return
    this.items = [item, ...this.items]
    this.paused = true
  }

  view(threadId: string | null): MessageQueueView {
    if (threadId !== this.threadId) return { items: [], paused: false }
    return { items: this.items, paused: this.paused }
  }
}
