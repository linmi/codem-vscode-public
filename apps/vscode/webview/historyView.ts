import { isBusy, type ChatPhase } from "../src/messages.ts"
import type { HistoryAction, HistoryList } from "../src/historyTypes.ts"
import { uiIcon } from "../src/uiIcons.ts"

export interface HistoryViewState {
  phase: ChatPhase
  threadId: string | null
  history: HistoryList
  hasOlderMessages: boolean
  historyNeedsRefresh: boolean
  backgroundBusy: boolean
}

export function createHistoryView(header: HTMLElement | null, scroller: HTMLElement, post: (action: HistoryAction) => void, returnFocus: HTMLElement): (state: HistoryViewState) => void {
  const button = (text: string, action: HistoryAction): HTMLButtonElement => {
    const node = document.createElement("button")
    node.type = "button"; node.className = "textButton"; node.textContent = text
    node.addEventListener("click", () => post(action))
    return node
  }
  const open = header ? document.createElement("button") : null
  if (open && header) {
    open.type = "button"
    open.addEventListener("click", () => post({ type: lastState?.history.open ? "closeHistory" : "showHistory" }))
    open.className = "iconButton"; open.innerHTML = uiIcon("history"); open.setAttribute("aria-label", "历史会话")
    open.title = "浏览当前工作区的历史会话"; open.setAttribute("aria-controls", "historyPanel")
    header.prepend(open)
  }
  const panel = document.createElement("section")
  panel.id = "historyPanel"; panel.className = "historyPanel"; panel.hidden = true; panel.setAttribute("aria-label", "历史会话")
  scroller.before(panel)
  const toolbar = document.createElement("div"); toolbar.className = "historyToolbar"
  const title = document.createElement("strong"); title.textContent = "历史会话"
  const refresh = button("刷新", { type: "refreshHistory" })
  const close = button("关闭", { type: "closeHistory" })
  toolbar.append(title, refresh, close)
  const status = document.createElement("p"); status.className = "historyStatus"; status.setAttribute("role", "status")
  const list = document.createElement("ul"); list.className = "historyEntries"
  const more = button("加载更多会话", { type: "moreThreads" })
  const search = document.createElement("input"); search.type = "search"; search.className = "historySearch"; search.placeholder = "搜索已加载的会话…"; search.setAttribute("aria-label", "搜索已加载的会话")
  const empty = document.createElement("p"); empty.className = "historyStatus"; empty.hidden = true; empty.textContent = "没有匹配的会话"
  panel.append(toolbar, search, status, list, empty, more)
  const paging = document.createElement("div"); paging.className = "historyPaging"
  const older = button("加载更早消息", { type: "olderMessages" })
  const reload = button("重新加载记录", { type: "reloadHistory" })
  const hint = document.createElement("span")
  toolbar.append(reload)
  paging.append(older, hint); scroller.prepend(paging)
  let previousEntries = ""
  let wasOpen = false
  panel.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); post({ type: "closeHistory" }) } })

  let lastState: HistoryViewState | null = null
  search.addEventListener("input", () => { if (lastState) render(lastState) })
  function render(state: HistoryViewState): void {
    lastState = state
    const disabled = isBusy(state.phase) || state.phase === "disconnected"
    if (open) {
      open.disabled = disabled && !state.history.open
      open.title = state.history.open ? "关闭历史会话" : "浏览当前工作区的历史会话"
      open.setAttribute("aria-expanded", String(state.history.open))
    }
    const restoreFocus = !state.history.open && wasOpen && panel.contains(document.activeElement)
    panel.hidden = !state.history.open
    if (state.history.open && !wasOpen) search.focus()
    if (restoreFocus) (open ?? returnFocus).focus()
    wasOpen = state.history.open
    panel.setAttribute("aria-busy", String(state.history.loading))
    refresh.disabled = more.disabled = disabled || state.history.loading
    more.hidden = !state.history.hasMore
    status.textContent = state.history.error ?? (state.phase === "loadingHistory" ? "正在恢复所选会话，当前记录暂时保留…" : state.history.loading ? "正在加载会话…" : state.history.entries.length ? `已显示 ${state.history.entries.length} 个会话` : "当前工作区还没有历史会话。")
    const switchingDisabled = disabled || state.backgroundBusy
    const key = JSON.stringify([state.history.entries, switchingDisabled, state.threadId, search.value])
    if (key !== previousEntries) {
      previousEntries = key
      const query = search.value.trim().toLocaleLowerCase()
      const filtered = state.history.entries.filter(entry => entry.title.toLocaleLowerCase().includes(query))
      empty.hidden = !query || filtered.length > 0
      let day = ""
      const rows: HTMLElement[] = []
      for (const entry of filtered) {
        const date = new Date(entry.startedAt)
        const nextDay = Number.isNaN(date.getTime()) ? "日期未知" : date.toLocaleDateString()
        if (day !== nextDay) { const heading = document.createElement("li"); heading.className = "historyDay"; heading.textContent = nextDay; rows.push(heading); day = nextDay }
        const row = document.createElement("li")
        const select = button("", { type: "resumeThread", threadId: entry.id }); select.className = "historyEntry"
        select.disabled = switchingDisabled || entry.archived
        if (entry.id === state.threadId) select.setAttribute("aria-current", "true")
        const label = document.createElement("span"); label.textContent = entry.title
        const detail = document.createElement("small")
        detail.textContent = `${Number.isNaN(date.getTime()) ? "" : date.toLocaleString()} · ${entry.turnCount} 轮${entry.archived ? " · 已归档" : ""}`
        select.append(label, detail); row.append(select)
        rows.push(row)
      }
      list.replaceChildren(...rows)
    }
    paging.hidden = !state.threadId || (!state.hasOlderMessages && !state.historyNeedsRefresh)
    reload.hidden = !state.threadId
    older.hidden = !state.hasOlderMessages
    older.disabled = reload.disabled = switchingDisabled
    hint.textContent = state.historyNeedsRefresh ? "记录已变化，重新加载后可继续翻页。" : ""
  }
  return render
}
