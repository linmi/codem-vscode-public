import { useState } from "react"
import { SearchIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Input } from "../components/ui/input.tsx"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog.tsx"
import type { ChatSnapshot } from "../contract.ts"

export function SearchExcerpt({ text, query }: { text: string; query: string }) {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  return index < 0 ? <>{text}</> : <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>
}
export function ConversationSearch({ snapshot, post }: { snapshot: ChatSnapshot; post: (action: Record<string, unknown>) => void }) {
  const view = snapshot.conversationSearch
  const [query, setQuery] = useState(view?.query ?? "")
  if (!view) return null
  const disabled = !snapshot.threadId || snapshot.phase !== "ready" || Boolean(snapshot.sessionTools.busy) || snapshot.backgroundBusy
  return <>
    <Dialog open={view.open} onOpenChange={open => post({ type: open ? "showConversationSearch" : "closeConversationSearch" })}>
      <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="搜索当前会话正文" title="搜索当前会话正文" disabled={disabled}><SearchIcon /></Button></DialogTrigger>
      <DialogContent className="conversationSearchDialog">
        <DialogHeader><DialogTitle>搜索当前会话</DialogTitle><DialogDescription>搜索已保存的用户消息与回复，包含未加载的早期消息。</DialogDescription></DialogHeader>
        <form onSubmit={event => { event.preventDefault(); if (query.trim() && !disabled) post({ type: "searchConversation", query: query.trim() }) }}>
          <Input autoFocus aria-label="正文关键词" placeholder="输入关键词" maxLength={512} value={query} onChange={event => setQuery(event.target.value)} />
          <Button type="submit" disabled={disabled || !query.trim()}>搜索</Button>
        </form>
        <div role="status" aria-live="polite">{view.status === "loading" ? "正在搜索…可输入新关键词重新搜索，或关闭取消。" : view.status === "ready" ? `${view.hits.length} 条匹配${view.truncated ? "（仅显示前 200 条，请缩小关键词范围）" : ""}` : ""}</div>
        {view.error ? <p role="alert">{view.error}</p> : null}
        <ul className="conversationSearchResults">{view.hits.map(hit => <li key={hit.id}><Button variant="ghost" disabled={disabled || view.status === "loading" || view.status === "error"} onClick={() => post({ type: "selectConversationSearchHit", id: hit.id })}><span>{hit.role === "user" ? "你" : "CodeM"}</span><span><SearchExcerpt text={hit.excerpt} query={view.query} /></span></Button></li>)}</ul>
      </DialogContent>
    </Dialog>
  </>
}
