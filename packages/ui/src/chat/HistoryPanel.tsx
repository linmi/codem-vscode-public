import { useEffect, useRef, useState } from "react"
import { isBusy, type ChatSnapshot } from "../contract.ts"
import { uiIcon } from "./uiIcons.ts"

/**
 * 对照 VS Code historyView：搜索、按天分组、加载更多和更早消息。
 * 面板常驻，关闭时用 hidden，焦点回到入口。
 */
export function HistoryButton({ snapshot, post }: { snapshot: ChatSnapshot; post: (action: Record<string, unknown>) => void }) {
  const history = snapshot.history
  return (
    <button
      type="button"
      className="iconButton"
      aria-label="历史会话"
      title={history.open ? "关闭历史会话" : "浏览当前工作区的历史会话"}
      aria-expanded={history.open}
      aria-controls="historyPanel"
      disabled={isBusy(snapshot.phase) && !history.open}
      onClick={() => post({ type: history.open ? "closeHistory" : "showHistory" })}
      dangerouslySetInnerHTML={{ __html: uiIcon("history") }}
    />
  )
}

export function HistoryPanel({
  snapshot,
  post,
}: {
  snapshot: ChatSnapshot
  post: (action: Record<string, unknown>) => void
}) {
  const history = snapshot.history
  const [query, setQuery] = useState("")
  const search = useRef<HTMLInputElement>(null)
  const wasOpen = useRef(false)
  const disabled = isBusy(snapshot.phase) || snapshot.phase === "disconnected"
  const switchingDisabled = disabled || snapshot.backgroundBusy
  useEffect(() => {
    if (history.open && !wasOpen.current) search.current?.focus()
    if (!history.open && wasOpen.current) document.querySelector<HTMLButtonElement>("[aria-controls='historyPanel']")?.focus()
    wasOpen.current = history.open
  }, [history.open])
  const filtered = history.entries.filter((entry) => entry.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  let day = ""
  const rows = filtered.flatMap((entry) => {
    const date = new Date(entry.startedAt ?? "")
    const nextDay = entry.startedAt && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : "日期未知"
    const heading = day === nextDay ? [] : [<li key={`day-${nextDay}-${entry.id}`} className="historyDay">{nextDay}</li>]
    day = nextDay
    return [
      ...heading,
      <li key={entry.id}>
        <button
          type="button"
          className="historyEntry"
          disabled={switchingDisabled || entry.archived}
          aria-current={entry.id === snapshot.threadId ? "true" : undefined}
          onClick={() => post({ type: "resumeThread", threadId: entry.id })}
        >
          <span>{entry.title}</span>
          <small>{`${entry.startedAt && !Number.isNaN(date.getTime()) ? date.toLocaleString() : ""} · ${entry.turnCount ?? 0} 轮${entry.archived ? " · 已归档" : ""}`}</small>
        </button>
      </li>,
    ]
  })
  const status = history.error ?? (snapshot.phase === "loadingHistory" ? "正在恢复所选会话，当前记录暂时保留…" : history.loading ? "正在加载会话…" : history.entries.length ? "" : "当前工作区还没有历史会话。")
  return (
    <section id="historyPanel" className="historyPanel" aria-label="历史会话" hidden={!history.open} aria-busy={history.loading} onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          post({ type: "closeHistory" })
        }
      }}>
        <div className="historyToolbar">
          <div className="historyHeading">
            <strong>历史会话</strong>
            <span className="historyCount" hidden={history.entries.length === 0} title={`已加载 ${history.entries.length} 个会话`}>{history.entries.length} 会话</span>
          </div>
          <button type="button" className="textButton" disabled={disabled || history.loading} onClick={() => post({ type: "refreshHistory" })}>刷新</button>
          <button type="button" className="textButton" onClick={() => post({ type: "closeHistory" })}>关闭</button>
          <button type="button" className="textButton" hidden={!snapshot.threadId} disabled={switchingDisabled} onClick={() => post({ type: "reloadHistory" })}>重新加载记录</button>
        </div>
        <input ref={search} type="search" className="historySearch" placeholder="搜索已加载的会话…" aria-label="搜索已加载的会话" value={query} onChange={(event) => setQuery(event.target.value)} />
        <p className="historyStatus" role="status" hidden={!status}>{status}</p>
        <ul className="historyEntries">{rows}</ul>
        <p className="historyStatus" hidden={!query.trim() || filtered.length > 0}>没有匹配的会话</p>
        <button type="button" className="textButton" hidden={!history.hasMore} disabled={disabled || history.loading} onClick={() => post({ type: "moreThreads" })}>加载更多会话</button>
      </section>
  )
}

export function HistoryPaging({ snapshot, post }: { snapshot: ChatSnapshot; post: (action: Record<string, unknown>) => void }) {
  const disabled = isBusy(snapshot.phase) || snapshot.backgroundBusy
  const visible = Boolean(snapshot.threadId) && (snapshot.hasOlderMessages || snapshot.historyNeedsRefresh)
  if (!visible) return null
  return (
    <div className="historyPaging">
      <button type="button" className="textButton" hidden={!snapshot.hasOlderMessages} disabled={disabled} onClick={() => post({ type: "olderMessages" })}>加载更早消息</button>
      <span>{snapshot.historyNeedsRefresh ? "记录已变化，重新加载后可继续翻页。" : ""}</span>
    </div>
  )
}
