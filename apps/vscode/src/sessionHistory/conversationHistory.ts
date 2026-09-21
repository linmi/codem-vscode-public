import type { AppServerHost, AppServerThreadSettings } from "@codem/app-server"
import type { SessionHistoryPage } from "@codem/history"
import { UserVisibleError } from "../shared/userVisibleError.ts"
import type { SessionHistoryReader } from "./sessionHistory.ts"

type HistoryHost = Pick<AppServerHost, "readThread" | "resumeThread" | "readModes" | "unsubscribeThread">
export interface HistoryContext {
  host: HistoryHost
  cwd: string
  authorize: () => Promise<void>
  readHistory: SessionHistoryReader
  /** Also rechecks workspace trust and absence of an active realtime turn. */
  assertCurrent: () => void
  connected: () => boolean
}
export interface RestoredConversation {
  page: SessionHistoryPage
  modes: Awaited<ReturnType<HistoryHost["readModes"]>>
}
export class HistoryRestoreFailure extends Error {
  readonly disconnect: boolean
  constructor(cause: unknown, disconnect: boolean) {
    super("History restore failed", { cause })
    this.disconnect = disconnect
  }
}

/** Owns the history read lease, opaque cursor and candidate subscription transaction. */
export class ConversationHistory {
  private cursor: string | null = null
  private operation: { abort: AbortController; restoringThreadId: string | null } | null = null
  private readonly report: (operation: string, error: unknown) => void

  constructor(report: (operation: string, error: unknown) => void) { this.report = report }
  get busy(): boolean { return this.operation !== null }
  get hasOlder(): boolean { return this.cursor !== null }

  reset(): void {
    this.invalidate()
    this.operation = null
  }

  invalidate(): void {
    this.operation?.abort.abort()
    this.cursor = null
    // Keep the lease until cleanup completes; a new restore must not race it.
  }

  turnStarted(threadId: string, currentThreadId: string | null): void {
    if (threadId === this.operation?.restoringThreadId && threadId !== currentThreadId) this.operation.abort.abort()
  }

  async restore(context: HistoryContext, threadId: string, previousThreadId: string | null, settings: AppServerThreadSettings, accept: (result: RestoredConversation) => void): Promise<void> {
    const operation = this.begin(threadId)
    let attached = false
    let releasingPrevious = false
    try {
      context.assertCurrent()
      await context.authorize()
      this.assertCurrent(context, operation)
      const detail = await context.host.readThread(context.cwd, threadId)
      this.assertCurrent(context, operation)
      if (detail.archived) throw new UserVisibleError("该会话已归档，无法继续对话。")
      await context.host.resumeThread(context.cwd, threadId, settings)
      attached = true
      this.assertCurrent(context, operation)
      const modes = await context.host.readModes(context.cwd, threadId)
      this.assertCurrent(context, operation)
      const page = await context.readHistory(threadId, undefined, operation.abort.signal)
      this.assertCurrent(context, operation)
      if (previousThreadId) {
        releasingPrevious = true
        await context.host.unsubscribeThread(context.cwd, previousThreadId)
        this.assertCurrent(context, operation)
      }
      this.cursor = page.nextCursor
      accept({ page, modes })
    } catch (error) {
      if (!context.connected()) return
      let cleanupFailed = false
      if (attached) {
        try { await context.host.unsubscribeThread(context.cwd, threadId) }
        catch (cleanupError) { cleanupFailed = true; this.report("historyCleanup", cleanupError) }
      }
      if (!context.connected()) return
      this.report("resumeHistory", error)
      if (releasingPrevious || cleanupFailed || !operation.abort.signal.aborted) throw new HistoryRestoreFailure(error, releasingPrevious || cleanupFailed)
    } finally {
      if (this.operation === operation) this.operation = null
    }
  }

  async load(context: HistoryContext, threadId: string, append: boolean, accept: (page: SessionHistoryPage) => void): Promise<void> {
    const cursor = append ? this.cursor ?? undefined : undefined
    const operation = this.begin(null)
    try {
      context.assertCurrent()
      const page = await context.readHistory(threadId, cursor, operation.abort.signal)
      this.assertCurrent(context, operation)
      if (append && page.nextCursor === cursor) throw new Error("History cursor did not advance")
      this.cursor = page.nextCursor
      accept(page)
    } catch (error) {
      if (!context.connected() || operation.abort.signal.aborted) return
      this.cursor = null
      this.report("historyPage", error)
      throw error
    } finally {
      if (this.operation === operation) this.operation = null
    }
  }

  private begin(restoringThreadId: string | null) {
    if (this.operation) throw new Error("History read already in progress")
    const operation = { abort: new AbortController(), restoringThreadId }
    this.operation = operation
    return operation
  }

  private assertCurrent(context: HistoryContext, operation: NonNullable<ConversationHistory["operation"]>): void {
    operation.abort.signal.throwIfAborted()
    if (this.operation !== operation) throw new Error("History operation expired")
    context.assertCurrent()
  }
}
