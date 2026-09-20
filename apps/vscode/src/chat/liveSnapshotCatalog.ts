import { randomUUID } from "node:crypto"
import type { AppServerHost, AppServerLivePage, AppServerLiveTurn, AppServerLiveItem } from "@codem/app-server"
import type { CatalogRow, LiveCatalogView, LiveSnapshotPageKind, LiveSnapshotPageView } from "../shared/capabilityTypes.ts"

interface SnapshotContext {
  host: Pick<AppServerHost, "listLoadedThreadIds" | "listLiveThreadTurns" | "listLiveThreadItems">
  cwd: string
  threadId: string | null
  authorize: () => Promise<void>
}
interface PageState { entries: Map<string, CatalogRow>; cursor: number | null; total: number }
class SnapshotChanged extends Error {}

/** Owns only live snapshot pages and opaque Core cursors, for one connection/thread. */
export class LiveSnapshotCatalog {
  private context: SnapshotContext | null = null
  private view: LiveCatalogView | null = null
  private pages: Record<LiveSnapshotPageKind, PageState> | null = null
  private revision = 0

  private readonly publish: (view: LiveCatalogView) => void
  private readonly assertTrusted: () => void
  private readonly report: (operation: string, error: unknown) => void

  constructor(publish: (view: LiveCatalogView) => void, assertTrusted: () => void, report: (operation: string, error: unknown) => void) {
    this.publish = publish; this.assertTrusted = assertTrusted; this.report = report
  }

  clear(): void { this.revision++; this.context = null; this.view = null; this.pages = null }

  invalidate(): void {
    if (!this.view) return
    this.revision++
    this.view = { ...this.view, snapshotId: randomUUID(), loading: null, stale: true, error: null }
    this.emit()
  }

  cancel(snapshotId: string): void {
    if (this.view?.snapshotId !== snapshotId || !this.view.loading) return
    this.revision++
    this.view = { ...this.view, snapshotId: randomUUID(), loading: null }
    this.emit()
  }

  async refresh(context: SnapshotContext): Promise<void> {
    if (this.view?.loading) return
    if (this.context?.host !== context.host || this.context.cwd !== context.cwd || this.context.threadId !== context.threadId) this.clear()
    this.context = context
    this.view = { kind: "live", snapshotId: randomUUID(), rows: this.view?.rows ?? [], pages: this.view?.pages ?? null, loaded: this.view?.loaded ?? false, stale: this.view?.loaded ?? false, error: null, loading: null }
    await this.run("refresh", async () => {
      const [loaded, turns, items] = await Promise.all([
        context.host.listLoadedThreadIds(context.cwd),
        context.threadId ? context.host.listLiveThreadTurns(context.cwd, context.threadId) : null,
        context.threadId ? context.host.listLiveThreadItems(context.cwd, context.threadId) : null,
      ])
      const pages = turns && items ? { turns: appendPage(null, turns, turnRow), items: appendPage(null, items, itemRow) } : null
      return () => {
        this.pages = pages
        this.view = { ...this.view!, loaded: true, stale: false, rows: [{ label: "已加载会话", detail: `${loaded.threadIds.length} 个；当前会话${context.threadId && loaded.threadIds.includes(context.threadId) ? "已加载" : "未加载"}` }], pages: pages ? { turns: pageView(pages.turns), items: pageView(pages.items) } : null }
      }
    })
  }

  async more(snapshotId: string, kind: LiveSnapshotPageKind): Promise<void> {
    const context = this.context, page = this.pages?.[kind]
    if (!context?.threadId || !page || page.cursor === null || this.view?.snapshotId !== snapshotId || !this.view.loaded || this.view.stale || this.view.loading) return
    await this.run(kind, async () => {
      const next = kind === "turns"
        ? appendPage(page, await context.host.listLiveThreadTurns(context.cwd, context.threadId!, page.cursor!), turnRow)
        : appendPage(page, await context.host.listLiveThreadItems(context.cwd, context.threadId!, page.cursor!), itemRow)
      return () => {
        this.pages = { ...this.pages!, [kind]: next }
        this.view = { ...this.view!, snapshotId: randomUUID(), pages: { ...this.view!.pages!, [kind]: pageView(next) } }
      }
    })
  }

  private async run(kind: NonNullable<LiveCatalogView["loading"]>, read: () => Promise<() => void>): Promise<void> {
    const revision = ++this.revision, context = this.context!
    this.view = { ...this.view!, loading: kind, error: null }
    this.emit()
    try {
      this.assertTrusted(); await context.authorize(); this.assertTrusted()
      if (revision !== this.revision) return
      const apply = await read()
      if (revision !== this.revision) return
      this.assertTrusted()
      apply()
    } catch (error) {
      if (revision !== this.revision) return
      this.report("liveSnapshot", error)
      this.view = { ...this.view!, stale: this.view!.stale || error instanceof SnapshotChanged, error: error instanceof SnapshotChanged ? "快照已变化或游标无效，请刷新。已有内容已保留。" : "快照加载失败，已有内容已保留；可重试或刷新。" }
    } finally {
      if (revision === this.revision) { this.view = { ...this.view!, loading: null }; this.emit() }
    }
  }

  private emit(): void {
    if (!this.view) return
    const copy = (page: LiveSnapshotPageView): LiveSnapshotPageView => ({ ...page, rows: page.rows.map(row => ({ ...row })) })
    this.publish({ ...this.view, rows: this.view.rows.map(row => ({ ...row })), pages: this.view.pages ? { turns: copy(this.view.pages.turns), items: copy(this.view.pages.items) } : null })
  }
}

function appendPage<T extends { readonly id: string }>(previous: PageState | null, page: AppServerLivePage<T>, project: (item: T, index: number) => CatalogRow): PageState {
  const entries = new Map(previous?.entries)
  if (previous && page.total !== previous.total) throw new SnapshotChanged("Live snapshot total changed")
  if (page.nextCursor !== null && (page.nextCursor <= (previous?.cursor ?? 0) || page.entries.length === 0)) throw new SnapshotChanged("Live snapshot cursor did not advance")
  for (const item of page.entries) {
    if (entries.has(item.id)) throw new SnapshotChanged(`Duplicate live snapshot item ${item.id}`)
    entries.set(item.id, project(item, entries.size))
  }
  if (entries.size > page.total) throw new SnapshotChanged("Live snapshot total is smaller than its entries")
  return { entries, cursor: page.nextCursor, total: page.total }
}
function pageView(page: PageState): LiveSnapshotPageView { return { rows: [...page.entries.values()], total: page.total, hasMore: page.cursor !== null } }
function turnRow(turn: AppServerLiveTurn, index: number): CatalogRow { return { label: `轮次 ${index + 1}`, detail: `${turn.status ?? "状态未知"} · ${turn.startedAt ?? "时间未知"}` } }
function itemRow(item: AppServerLiveItem, index: number): CatalogRow { return { label: `项目 ${index + 1} · ${item.type}`, detail: item.status } }
