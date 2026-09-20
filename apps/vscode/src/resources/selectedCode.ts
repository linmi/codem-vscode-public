import { randomUUID } from "node:crypto"
import { appendContext, codePrompt, codePromptParts, MAX_PINNED_CODE_SELECTIONS, type CodeContext } from "../shared/editorContext.ts"
import type { CodeSelectionView, CodeSelectionsView } from "../shared/messages.ts"

export interface SelectedCode { key: string; uri: string; version: number; start: { line: number; character: number }; end: { line: number; character: number }; context: CodeContext }

type Entry = { source: SelectedCode; view: CodeSelectionView }

/** Session-local source snapshots. The Webview receives only an opaque handle and display metadata. */
export class SelectedCodeState {
  private key: string | null = null
  private current: Entry | null = null
  private readonly pinned = new Map<string, Entry>()
  private scope: { workspace: string | null; space: string | null; threadId: string | null } | null = null
  private readonly changed: (view: CodeSelectionsView) => void
  constructor(changed: (view: CodeSelectionsView) => void) { this.changed = changed }
  snapshot(): CodeSelectionsView { return { current: this.current ? { ...this.current.view } : null, pinned: [...this.pinned.values()].map(entry => ({ ...entry.view })) } }
  capture(source: SelectedCode | null): void {
    if (source?.key === this.key) return
    this.key = source?.key ?? null
    if (!source || !source.context.text.trim() || [...this.pinned.values()].some(entry => entry.source.key === source.key)) { this.current = null; this.changed(this.snapshot()); return }
    const { context } = source
    this.current = { source: structuredClone(source), view: {
      id: randomUUID(), label: context.path.split(/[\\/]/).at(-1)!, path: context.path,
      startLine: context.startLine, endLine: context.endLine,
      error: context.text.length > 24_000 ? "选区过大，请缩小到 24000 字符以内。" : null,
    } }
    this.changed(this.snapshot())
  }
  clear(): void { this.current = null; this.pinned.clear(); this.changed(this.snapshot()) }
  pin(id: string): void {
    if (this.pinned.has(id)) return
    if (this.current?.view.id !== id) throw new Error("代码选区已变化，请重新选择。")
    if (this.current.view.error) throw new Error(this.current.view.error)
    if (this.pinned.size >= MAX_PINNED_CODE_SELECTIONS) throw new Error("最多固定 20 段代码，请先移除部分引用。")
    // Reject excessive accumulated context before committing a new reference.
    this.prompt([...this.pinned.keys(), id], "")
    this.pinned.set(id, this.current); this.current = null; this.changed(this.snapshot())
  }
  remove(id: string): void { this.consume([id]) }
  consume(ids: readonly string[]): void {
    let changed = false
    for (const id of ids) {
      if (this.pinned.delete(id)) changed = true
      if (this.current?.view.id === id) { this.current = null; changed = true }
    }
    if (changed) this.changed(this.snapshot())
  }
  read(id: string): SelectedCode {
    const entry = this.pinned.get(id) ?? (this.current?.view.id === id ? this.current : null)
    if (!entry) throw new Error("代码选区已变化，请确认当前选区后重试。")
    return structuredClone(entry.source)
  }
  prompt(ids: readonly string[], text: string): string {
    return ids.reduce((draft, id) => appendContext(draft, codePrompt("addToContext", this.read(id).context)), text)
  }
  matchingIds(uri: string, text: string): string[] {
    const parts = codePromptParts(text).filter(part => part.kind === "code")
    return [...this.pinned.values(), ...(this.current ? [this.current] : [])].filter(({ source }) => source.uri === uri && parts.some(part => part.startLine === source.context.startLine && part.endLine === source.context.endLine && part.text === source.context.text)).map(entry => entry.view.id)
  }
  invalidate(uri: string): void { if (this.current?.source.uri === uri) this.remove(this.current.view.id) }
  setContext(next: { workspace: string | null; space: string | null; threadId: string | null }): void {
    const previous = this.scope
    this.scope = { workspace: next.workspace, space: next.space, threadId: next.threadId }
    if (previous && ((previous.workspace !== null && previous.workspace !== next.workspace) || (previous.space !== null && previous.space !== next.space) || (previous.threadId !== null && previous.threadId !== next.threadId))) this.clear()
  }
}
