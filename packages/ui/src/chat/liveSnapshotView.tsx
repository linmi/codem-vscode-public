import type { CatalogSnapshot } from "../contract.ts"

type LiveSnapshotAction = { type: "cancelLiveSnapshot"; snapshotId: string } | { type: "loadMoreLiveSnapshot"; snapshotId: string; kind: "turns" | "items" }
import { Button } from "../components/ui/button.tsx"

export function LiveSnapshotView({ view, disabled, post }: { view: CatalogSnapshot; disabled: boolean; post: (action: LiveSnapshotAction) => void }) {
  return <div className="sessionToolSection">
    <p>当前连接中的实时快照，不用于恢复历史记录。</p>
    {view.stale && <p role="status">快照已变化，请刷新后继续翻页。</p>}
    {view.error && <p role="alert">{view.error}</p>}
    {view.loading && view.snapshotId && <div className="sessionToolActions"><span role="status">{view.loading === "refresh" ? "正在刷新快照…" : `正在加载${view.loading === "turns" ? "轮次" : "Item"}…`}</span><Button variant="outline" size="sm" onClick={() => post({ type: "cancelLiveSnapshot", snapshotId: view.snapshotId! })}>取消加载</Button></div>}
    <dl className="catalogRows">{view.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.detail}</dd></div>)}</dl>
    {view.pages && (["turns", "items"] as const).map(kind => {
      const page = view.pages![kind], label = kind === "turns" ? "轮次" : "Item"
      return <section key={kind} aria-label={`${label}快照`} className="sessionToolSection">
        <strong>{label} · 已加载 {page.rows.length} / {page.total}</strong>
        {!page.rows.length && <p>暂无{label}</p>}
        <dl className="catalogRows">{page.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.detail}</dd></div>)}</dl>
        {view.loaded && !view.stale && view.snapshotId && page.hasMore && <Button variant="outline" size="sm" disabled={disabled || Boolean(view.loading)} onClick={() => post({ type: "loadMoreLiveSnapshot", snapshotId: view.snapshotId!, kind })}>加载更多{label}</Button>}
      </section>
    })}
  </div>
}
