import type { ChatSnapshot } from "../contract.ts"

/** Deterministic UI-only fixture, never calls Core or reads user history. */
export function conversationSearchPreview(publish: (snapshot: ChatSnapshot) => void, initial: ChatSnapshot) {
  let state: ChatSnapshot = { ...initial, messages: [{ id: "recent", role: "assistant", text: "最近的回复。早期正文尚未加载。" }], conversationSearch: { open: false, status: "idle", query: "", hits: [], truncated: false, error: null, target: null, historical: false } }
  const message = { id: "early", role: "assistant" as const, text: "早期会话：验收关键词 Orion 已完成，支持从未加载的历史定位。" }
  let revision = 0
  publish(state)
  return (action: Record<string, unknown>) => {
    const view = state.conversationSearch!
    if (action.type === "showConversationSearch") state = { ...state, conversationSearch: { ...view, open: true } }
    else if (action.type === "closeConversationSearch") { revision++; state = { ...state, conversationSearch: { ...view, open: false, status: "idle" } } }
    else if (action.type === "searchConversation") {
      const query = String(action.query), current = ++revision
      state = { ...state, conversationSearch: { ...view, query, status: "loading", hits: [], error: null } }; publish(state)
      window.setTimeout(() => {
        if (revision !== current) return
        state = { ...state, conversationSearch: { ...state.conversationSearch!, status: query === "失败" ? "error" : "ready", error: query === "失败" ? "搜索失败，请重试。" : null, hits: message.text.toLowerCase().includes(query.toLowerCase()) ? [{ id: "early-hit", role: "assistant", excerpt: message.text }] : [] } }; publish(state)
      }, 400)
      return
    } else if (action.type === "selectConversationSearchHit" && action.id === "early-hit") state = { ...state, messages: [message], conversationSearch: { ...view, open: false, historical: true, target: message.id } }
    else if (action.type === "reloadHistory") state = { ...state, messages: [{ id: "recent", role: "assistant", text: "最近的回复。" }], conversationSearch: { ...view, target: null, historical: false } }
    else return
    publish(state)
  }
}
