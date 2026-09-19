import { isBusy, type ChatPhase } from "../src/messages.ts"
import type { HistoryAction, HistoryList } from "../src/historyTypes.ts"

export interface HistoryViewState {
  phase: ChatPhase
  threadId: string | null
  history: HistoryList
  hasOlderMessages: boolean
  historyNeedsRefresh: boolean
  backgroundBusy: boolean
}

export function createHistoryView(header: HTMLElement, scroller: HTMLElement, post: (action: HistoryAction) => void): (state: HistoryViewState) => void {
  const button = (text: string, action: HistoryAction): HTMLButtonElement => {
    const node = document.createElement("button")
    node.type = "button"; node.className = "textButton"; node.textContent = text
    node.addEventListener("click", () => post(action))
    return node
  }
  const open = button("历史", { type: "showHistory" })
  open.title = "浏览当前工作区的历史会话"; open.setAttribute("aria-controls", "historyPanel")
  header.prepend(open)
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
  panel.append(toolbar, status, list, more)
  const paging = document.createElement("div"); paging.className = "historyPaging"
  const older = button("加载更早消息", { type: "olderMessages" })
  const reload = button("重新加载记录", { type: "reloadHistory" })
  const hint = document.createElement("span")
  paging.append(older, reload, hint); scroller.prepend(paging)
  let previousEntries = ""

  return (state) => {
    const disabled = isBusy(state.phase) || state.phase === "disconnected"
    open.disabled = disabled
    open.setAttribute("aria-expanded", String(state.history.open))
    panel.hidden = !state.history.open
    panel.setAttribute("aria-busy", String(state.history.loading))
    refresh.disabled = more.disabled = disabled || state.history.loading
    more.hidden = !state.history.hasMore
    status.textContent = state.history.error ?? (state.history.loading ? "正在加载会话…" : state.history.entries.length ? `已显示 ${state.history.entries.length} 个会话` : "当前工作区还没有历史会话。")
    const switchingDisabled = disabled || state.backgroundBusy
    const key = JSON.stringify([state.history.entries, switchingDisabled, state.threadId])
    if (key !== previousEntries) {
      previousEntries = key
      list.replaceChildren(...state.history.entries.map((entry) => {
        const row = document.createElement("li")
        const select = button("", { type: "resumeThread", threadId: entry.id }); select.className = "historyEntry"
        select.disabled = switchingDisabled || entry.archived
        if (entry.id === state.threadId) select.setAttribute("aria-current", "true")
        const label = document.createElement("span"); label.textContent = entry.title
        const detail = document.createElement("small")
        const date = new Date(entry.startedAt)
        detail.textContent = `${Number.isNaN(date.getTime()) ? "" : date.toLocaleString()} · ${entry.turnCount} 轮${entry.archived ? " · 已归档" : ""}`
        select.append(label, detail); row.append(select)
        return row
      }))
    }
    paging.hidden = !state.threadId
    older.hidden = !state.hasOlderMessages
    older.disabled = reload.disabled = switchingDisabled
    hint.textContent = state.historyNeedsRefresh ? "记录已变化，重新加载后可继续翻页。" : ""
  }
}
