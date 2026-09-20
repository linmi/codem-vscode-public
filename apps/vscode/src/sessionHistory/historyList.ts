import type { AppServerHost } from "@codem/app-server"
import { emptyHistoryList, type HistoryList } from "../shared/historyTypes.ts"

export interface HistoryListContext {
  host: Pick<AppServerHost, "listThreads" | "readThread">
  cwd: string
  authorize: () => Promise<void>
}

/** A connection-scoped browser. Core's opaque cursor never leaves Host. */
export class HistoryListController {
  private context: HistoryListContext | null = null
  private state: HistoryList = emptyHistoryList()
  private cursor: string | null = null
  private readonly cursors = new Set<string>()
  private revision = 0
  private readonly publish: () => void
  private readonly report: (operation: string, error: unknown) => void

  constructor(publish: () => void, report: (operation: string, error: unknown) => void) {
    this.publish = publish
    this.report = report
  }

  snapshot(): HistoryList { return { ...this.state, entries: this.state.entries.map((entry) => ({ ...entry })) } }

  bind(context: HistoryListContext | null): void {
    this.revision++
    this.context = context
    this.cursor = null
    this.cursors.clear()
    this.state = emptyHistoryList()
  }

  close(): void { this.state = { ...this.state, open: false }; this.publish() }

  async open(): Promise<void> {
    if (!this.context) return
    this.state = { ...this.state, open: true }
    this.publish()
    await this.refresh()
  }

  async refresh(): Promise<void> { await this.load(false) }
  async more(): Promise<void> { if (this.cursor) await this.load(true) }

  private async load(append: boolean): Promise<void> {
    const context = this.context
    if (!context || this.state.loading) return
    const revision = this.revision
    const cursor = append ? this.cursor ?? undefined : undefined
    this.state = { ...this.state, loading: true, error: null }
    this.publish()
    try {
      await context.authorize()
      if (revision !== this.revision) return
      const page = await context.host.listThreads(context.cwd, cursor)
      if (revision !== this.revision) return
      if (page.nextCursor !== null && (!page.nextCursor || (append && this.cursors.has(page.nextCursor)))) throw new Error("History list cursor did not advance")
      // Core 0.8.44 omits persisted names from thread/list; read each page's metadata once.
      const details = await Promise.all(page.threads.map(thread => context.host.readThread(context.cwd, thread.id)))
      if (revision !== this.revision) return
      const names = new Map(details.map(thread => [thread.id, thread.name]))
      const entries = new Map((append ? this.state.entries : []).map((entry) => [entry.id, entry]))
      for (const thread of page.threads) entries.set(thread.id, {
        id: thread.id, title: names.get(thread.id)?.trim().slice(0, 160) || thread.preview.trim().slice(0, 160) || "未命名会话", startedAt: thread.startedAt, turnCount: thread.turnCount, archived: thread.archived,
      })
      if (!append) this.cursors.clear()
      if (page.nextCursor) this.cursors.add(page.nextCursor)
      this.cursor = page.nextCursor
      this.state = { ...this.state, entries: [...entries.values()], hasMore: page.nextCursor !== null, loading: false }
    } catch (error) {
      if (revision !== this.revision) return
      this.report("historyList", error)
      this.state = { ...this.state, loading: false, error: "历史会话加载失败，请刷新或重试。" }
    }
    this.publish()
  }
}
