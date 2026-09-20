import { randomUUID } from "node:crypto"
import { appendContext, codePrompt, type CodeContext } from "../shared/editorContext.ts"
import type { CodeSelectionView } from "../shared/messages.ts"

export interface SelectedCode { key: string; uri: string; version: number; start: { line: number; character: number }; end: { line: number; character: number }; context: CodeContext }

/** Session-local source snapshots. The Webview receives only an opaque handle and display metadata. */
export class SelectedCodeState {
  private key: string | null = null
  private current: { source: SelectedCode; view: CodeSelectionView } | null = null
  private scope: { workspace: string | null; space: string | null; threadId: string | null } | null = null
  private readonly changed: (view: CodeSelectionView | null) => void
  constructor(changed: (view: CodeSelectionView | null) => void) { this.changed = changed }
  snapshot(): CodeSelectionView | null { return this.current ? { ...this.current.view } : null }
  capture(source: SelectedCode | null): void {
    if (source?.key === this.key) return
    this.key = source?.key ?? null
    if (!source || !source.context.text.trim()) { this.clear(); return }
    const { context } = source
    this.current = { source: structuredClone(source), view: {
      id: randomUUID(), label: context.path.split(/[\\/]/).at(-1)!, path: context.path,
      startLine: context.startLine, endLine: context.endLine,
      error: context.text.length > 24_000 ? "选区过大，请缩小到 24000 字符以内。" : null,
    } }
    this.changed(this.snapshot())
  }
  clear(): void { if (this.current) { this.current = null; this.changed(null) } }
  remove(id: string): void { if (this.current?.view.id === id) this.clear() }
  read(id: string): SelectedCode {
    if (this.current?.view.id !== id) throw new Error("代码选区已变化，请确认当前选区后重试。")
    return structuredClone(this.current.source)
  }
  prompt(id: string, text: string): string { return appendContext(text, codePrompt("addToContext", this.read(id).context)) }
  invalidate(uri: string): void { if (this.current?.source.uri === uri) this.clear() }
  setContext(next: { workspace: string | null; space: string | null; threadId: string | null }): void {
    const previous = this.scope
    this.scope = { workspace: next.workspace, space: next.space, threadId: next.threadId }
    if (previous && ((previous.workspace !== null && previous.workspace !== next.workspace) || (previous.space !== null && previous.space !== next.space) || (previous.threadId !== null && previous.threadId !== next.threadId))) this.clear()
  }
}
