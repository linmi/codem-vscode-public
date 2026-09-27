import { randomUUID } from "node:crypto"
import type { AppServerHostEvent, AppServerInteraction, AppServerThreadSettings } from "@codem/app-server"
import type { LiveSessionStatus, LiveSessionView } from "../shared/historyTypes.ts"

/** A turn the chat handed to the background. Core keeps running it; this only records what the chat needs to take it back. */
export interface ParkedTurn {
  threadId: string
  title: string
  /** The settings the thread is subscribed with; a running thread cannot be resumed with others. */
  settings: AppServerThreadSettings
  turnId: string
  submissionId: string
  pending: readonly AppServerInteraction[]
}

/** What the chat receives when it takes a parked thread back into the foreground. */
export interface ReclaimedTurn {
  /** Null once the turn has ended: the chat reads the result from Core's history. */
  turn: { turnId: string; submissionId: string; pending: readonly AppServerInteraction[] } | null
  /** The turn ended while the chat was reading history, so that read may miss its last items. */
  endedDuringClaim: boolean
}

interface Entry {
  threadId: string
  title: string
  settings: AppServerThreadSettings
  turnId: string
  submissionId: string
  status: LiveSessionStatus
  pending: Map<string, AppServerInteraction>
  /** The chat is restoring this thread; it will own the subscription, so an ended turn is not released here. */
  claimed: boolean
  endedDuringClaim: boolean
  /** The unsubscribe that follows an ended turn; a restore waits for it so it never resumes a thread being released. */
  releasing: Promise<void> | null
}

const MAX_ENDED = 10
const endedStatus = { completed: "completed", stopped: "stopped", failed: "failed" } as const

/**
 * Conversations left running when the chat switched to another thread. Owns their subscriptions until the
 * turn ends (then unsubscribes) or the chat takes them back; never projects their messages, which Core records.
 */
export class ParkedConversations {
  private readonly entries = new Map<string, Entry>()
  private view: readonly LiveSessionView[] = []
  private readonly changed: () => void
  private readonly release: (threadId: string) => Promise<void>
  private readonly report: (operation: string, error: unknown) => void

  constructor(changed: () => void, release: (threadId: string) => Promise<void>, report: (operation: string, error: unknown) => void) {
    this.changed = changed
    this.release = release
    this.report = report
  }

  /** Published frozen with the chat snapshot; replaced on every change. */
  snapshot(): readonly LiveSessionView[] { return this.view }

  has(threadId: string): boolean { return this.entries.has(threadId) }

  /** A thread whose turn is still running here would be interrupted by closing the connection. */
  running(): boolean { return [...this.entries.values()].some(entry => entry.status === "running" || entry.status === "awaitingApproval") }

  park(turn: ParkedTurn): void {
    this.entries.delete(turn.threadId)
    this.entries.set(turn.threadId, {
      threadId: turn.threadId, title: turn.title, settings: turn.settings, turnId: turn.turnId, submissionId: turn.submissionId,
      status: turn.pending.length ? "awaitingApproval" : "running", pending: new Map(turn.pending.map(request => [request.requestId, request])),
      claimed: false, endedDuringClaim: false, releasing: null,
    })
    this.publish()
  }

  /**
   * Marks a thread as being restored. Returns the settings it must be resumed with while it still runs,
   * after any release in flight has settled; null when the thread is not parked.
   */
  async claim(threadId: string): Promise<{ settings: AppServerThreadSettings | null } | null> {
    const entry = this.entries.get(threadId)
    if (!entry) return null
    entry.claimed = true
    entry.endedDuringClaim = false
    await entry.releasing?.catch(() => undefined)
    return { settings: this.isRunning(entry) ? entry.settings : null }
  }

  /** The restore failed: the thread stays parked, and an ended turn is released as if it had never been claimed. */
  unclaim(threadId: string): void {
    const entry = this.entries.get(threadId)
    if (!entry?.claimed) return
    entry.claimed = false
    if (!this.isRunning(entry) && entry.endedDuringClaim) this.releaseEnded(entry)
  }

  /** The chat now owns the thread and its subscription. */
  take(threadId: string): ReclaimedTurn | null {
    const entry = this.entries.get(threadId)
    if (!entry) return null
    this.entries.delete(threadId)
    this.publish()
    return {
      turn: this.isRunning(entry) ? { turnId: entry.turnId, submissionId: entry.submissionId, pending: [...entry.pending.values()] } : null,
      endedDuringClaim: entry.endedDuringClaim,
    }
  }

  /** Consumes every event of a parked thread; returns false for events the chat handles itself. */
  handle(event: AppServerHostEvent): boolean {
    if (event.type === "interaction") {
      const entry = this.entries.get(event.interaction.threadId)
      if (!entry) return false
      if (this.isRunning(entry) && event.interaction.turnId === entry.turnId) {
        entry.pending.set(event.interaction.requestId, event.interaction)
        this.setStatus(entry, "awaitingApproval")
      }
      return true
    }
    if (!("threadId" in event) || event.threadId === null) return false
    const entry = this.entries.get(event.threadId)
    if (!entry) return false
    if (event.type === "interaction-resolved" && event.turnId === entry.turnId) {
      entry.pending.delete(event.requestId)
      if (!entry.pending.size && entry.status === "awaitingApproval") this.setStatus(entry, "running")
    } else if (event.type === "turn-started" && !this.isRunning(entry) && entry.releasing === null) {
      // Core woke the thread before the release; it keeps running here until it ends again.
      entry.turnId = event.turnId
      entry.submissionId = event.submissionId ?? randomUUID()
      entry.endedDuringClaim = false
      this.setStatus(entry, "running")
    } else if (event.type === "turn-completed" && event.turnId === entry.turnId && this.isRunning(entry)) {
      entry.pending.clear()
      if (entry.claimed) entry.endedDuringClaim = true
      this.setStatus(entry, endedStatus[event.outcome])
      if (!entry.claimed) this.releaseEnded(entry)
    } else if (event.type === "thread-closed" && event.reason !== "unsubscribed") {
      // Archived, deleted or dropped by Core: nothing is left to take back.
      this.entries.delete(entry.threadId)
      this.publish()
    }
    return true
  }

  /** The connection is gone; Core ended every parked turn with it. */
  clear(): void {
    if (!this.entries.size) return
    this.entries.clear()
    this.publish()
  }

  private isRunning(entry: Entry): boolean { return entry.status === "running" || entry.status === "awaitingApproval" }

  private releaseEnded(entry: Entry): void {
    const releasing = this.release(entry.threadId).catch(error => { this.report("releaseParkedThread", error) })
    entry.releasing = releasing
    void releasing.then(() => { if (entry.releasing === releasing) entry.releasing = null })
    // Ended conversations stay listed until viewed; the oldest beyond the limit are dropped.
    const ended = [...this.entries.values()].filter(item => !this.isRunning(item) && !item.claimed)
    for (const item of ended.slice(0, Math.max(0, ended.length - MAX_ENDED))) this.entries.delete(item.threadId)
    this.publish()
  }

  private setStatus(entry: Entry, status: LiveSessionStatus): void {
    if (entry.status === status) return
    entry.status = status
    this.publish()
  }

  private publish(): void {
    this.view = [...this.entries.values()].reverse().map(entry => ({ id: entry.threadId, title: entry.title, status: entry.status }))
    this.changed()
  }
}
