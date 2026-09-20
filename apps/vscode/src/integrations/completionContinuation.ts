type Insertion = { rangeOffset: number; rangeLength: number; text: string }

/** One recently generated suggestion, consumed only by exact prefix typing at its cursor.
 * It is not a model/auth cache: edits elsewhere, selection, context/settings changes and
 * 15 seconds of age invalidate it. No persistent data or cross-document reuse.
 */
export class CompletionContinuation<Document> {
  private candidate: { document: Document; version: number; offset: number; scope: string; text: string; expires: number } | null = null
  private readonly now: () => number
  constructor(now: () => number = Date.now) { this.now = now }
  remember(document: Document, version: number, offset: number, scope: string, text: string): void {
    this.candidate = { document, version, offset, scope, text, expires: this.now() + 15000 }
  }
  read(document: Document, version: number, offset: number, scope: string): string | null {
    const value = this.candidate
    if (!value) return null
    if (value.document !== document || value.version !== version || value.offset !== offset || value.scope !== scope || value.expires <= this.now()) { this.clear(); return null }
    return value.text
  }
  changed(document: Document, version: number, changes: readonly Insertion[]): void {
    const value = this.candidate
    if (!value || value.document !== document) return
    if (!changes.length) return
    const change = changes[0]!
    if (changes.length !== 1 || version <= value.version || change.rangeOffset !== value.offset || change.rangeLength !== 0 || !change.text || !value.text.startsWith(change.text)) { this.clear(); return }
    value.version = version; value.offset += change.text.length; value.text = value.text.slice(change.text.length)
  }
  clear(): void { this.candidate = null }
}
