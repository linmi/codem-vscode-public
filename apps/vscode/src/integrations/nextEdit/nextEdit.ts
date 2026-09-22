import * as vscode from "vscode"
import { randomUUID } from "node:crypto"
import { nextEditPrompt, parseNextEdit, type NextEditProposal, type RecentEdit, type NextEditContext } from "./nextEditProposal.ts"

interface NextEditHost {
  contextKey(): string
  completionContext(): { ready: boolean; key: string }
  assertContextWorkspace(path: string): Promise<void>
  generateText(prompt: string, signal: AbortSignal, scope: string): Promise<string>
}
interface Suggestion { id: string; editor: vscode.TextEditor; version: number; key: string; edit: NextEditProposal; jumped: boolean }
interface Generation { editor: vscode.TextEditor; version: number; abort: AbortController; settled: Promise<void> }

/** Owns one editor's recent edit, generation lease and unaccepted next-edit proposal. */
export class NextEdit implements vscode.Disposable {
  private active: Generation | null = null
  private suggestion: Suggestion | null = null
  private observed: { document: vscode.TextDocument; text: string; version: number; key: string } | null = null
  private recent: RecentEdit | null = null
  private applying = false
  private disposed = false
  private renderedReady = false
  private readonly lenses = new vscode.EventEmitter<void>()
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
  private readonly decoration = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor("diffEditor.removedTextBackground"), overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.modifiedForeground"), overviewRulerLane: vscode.OverviewRulerLane.Right })
  private readonly subscriptions: vscode.Disposable[]
  constructor(private readonly host: NextEditHost, private readonly log: (line: string) => void) {
    const run = (operation: (id?: string) => Promise<void> | void) => (id?: string) => Promise.resolve().then(() => operation(id)).catch(error => { this.log("Next Edit: operation failed"); void vscode.window.showWarningMessage(error instanceof Error ? error.message : "Next Edit 失败，请重试。") })
    this.subscriptions = [this.status, this.decoration, this.lenses,
      vscode.commands.registerCommand("codem.predictNextEdit", run(() => this.predict())),
      vscode.commands.registerCommand("codem.jumpNextEdit", run(id => this.jump(id))),
      vscode.commands.registerCommand("codem.acceptNextEdit", run(id => this.accept(id))),
      vscode.commands.registerCommand("codem.dismissNextEdit", () => this.clear()),
      vscode.languages.registerCodeLensProvider({ scheme: "file" }, { onDidChangeCodeLenses: this.lenses.event, provideCodeLenses: document => {
        const suggestion = this.suggestion
        if (!suggestion || suggestion.editor.document !== document || !this.valid(suggestion) || this.applying) return []
        const range = this.range(suggestion)
        return [new vscode.CodeLens(range, { title: "Next Edit · 跳转", tooltip: suggestion.edit.reason, command: "codem.jumpNextEdit", arguments: [suggestion.id] }), new vscode.CodeLens(range, { title: "接受修改", command: "codem.acceptNextEdit", arguments: [suggestion.id] }), new vscode.CodeLens(range, { title: "取消", command: "codem.dismissNextEdit" })]
      } }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (!event.contentChanges.length || event.document !== vscode.window.activeTextEditor?.document) return
        const previous = this.observed
        this.clear()
        this.recent = null
        if (!this.applying && event.reason === undefined && previous?.document === event.document && previous.key === this.host.completionContext().key && event.document.version > previous.version && event.contentChanges.length === 1) {
          const change = event.contentChanges[0]!
          const before = previous.text.slice(change.rangeOffset, change.rangeOffset + change.rangeLength)
          if (before.length <= 2000 && change.text.length <= 2000) this.recent = { before, after: change.text, line: change.range.start.line + 1 }
        }
        this.observe()
      }),
      vscode.window.onDidChangeActiveTextEditor(() => { this.clear(); this.recent = null; this.observe(); this.render() }),
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (this.active?.editor === event.textEditor) this.clear()
        if (this.suggestion?.editor === event.textEditor) { this.suggestion.jumped = event.textEditor.selection.isEmpty && event.textEditor.selection.active.isEqual(this.range(this.suggestion).start); this.render() }
      }),
      vscode.workspace.onDidCloseTextDocument(document => { if (this.observed?.document === document) { this.clear(); this.observed = null; this.recent = null } }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { this.clear(); this.observed = null; this.recent = null }),
    ]
    this.observe(); this.render()
  }
  contextChanged(): void {
    if (this.suggestion && !this.valid(this.suggestion)) this.clear()
    if (this.observed && this.observed.key !== this.host.completionContext().key) { this.recent = null; this.observe() }
    if (this.suggestion && this.renderedReady !== this.host.completionContext().ready) this.render()
    // generateText itself owns cancellation on session retirement; first thread/start
    // legitimately changes the context key during this feature's own generation.
  }
  private observe(): void {
    const document = vscode.window.activeTextEditor?.document
    this.observed = null
    if (!document || document.uri.scheme !== "file" || document.isClosed || document.offsetAt(document.lineAt(document.lineCount - 1).range.end) > 100000) return
    this.observed = { document, text: document.getText(), version: document.version, key: this.host.completionContext().key }
  }
  private valid(suggestion: Suggestion): boolean {
    return !this.disposed && vscode.workspace.isTrusted && this.host.completionContext().key === suggestion.key && vscode.window.activeTextEditor === suggestion.editor && !suggestion.editor.document.isClosed && suggestion.editor.document.version === suggestion.version
  }
  private range(suggestion: Suggestion): vscode.Range { return new vscode.Range(suggestion.editor.document.positionAt(suggestion.edit.start), suggestion.editor.document.positionAt(suggestion.edit.end)) }
  private clear(): void { this.active?.abort.abort(); this.suggestion = null; this.render() }
  private render(): void {
    if (this.disposed) return
    const suggestion = this.suggestion, busy = this.active !== null
    this.renderedReady = this.host.completionContext().ready
    void vscode.commands.executeCommand("setContext", "codem.nextEditVisible", Boolean(suggestion) && !this.applying && this.renderedReady)
    void vscode.commands.executeCommand("setContext", "codem.nextEditAtTarget", Boolean(suggestion?.jumped))
    void vscode.commands.executeCommand("setContext", "codem.nextEditBusy", busy)
    for (const editor of vscode.window.visibleTextEditors) {
      const edit = suggestion?.editor === editor ? suggestion.edit : null
      editor.setDecorations(this.decoration, edit && suggestion ? [{ range: this.range(suggestion), hoverMessage: new vscode.MarkdownString().appendText(edit.reason).appendText("\n替换为：\n").appendCodeblock(edit.after || "（删除此处）", editor.document.languageId), renderOptions: { after: { contentText: ` → ${edit.after.replace(/\s+/gu, " ").slice(0, 100) || "（删除）"}`, color: new vscode.ThemeColor("editorGhostText.foreground"), margin: "0 0 0 1em" } } }] : [])
    }
    this.lenses.fire()
    this.status.text = busy ? this.active!.abort.signal.aborted ? "$(sync~spin) Next Edit · 取消中" : "$(sync~spin) Next Edit · 预测中" : suggestion ? `$(arrow-right) Next Edit · 第 ${this.range(suggestion).start.line + 1} 行` : "$(sparkle) Next Edit"
    this.status.command = busy ? "codem.dismissNextEdit" : suggestion ? "codem.jumpNextEdit" : "codem.predictNextEdit"
    this.status.tooltip = busy ? "点击取消预测" : suggestion ? "跳转后按 Tab 接受；Esc 取消。悬浮高亮处查看完整替换内容。" : "预测当前文件的下一处修改（手动触发）"
    this.status.accessibilityInformation = { label: this.status.text.replace(/\$\([^)]*\)/gu, "") }
    if (!this.disposed && vscode.window.activeTextEditor?.document.uri.scheme === "file") this.status.show(); else this.status.hide()
  }
  async predict(): Promise<void> {
    if (this.applying) throw new Error("正在应用修改，请稍候。")
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.document.uri.scheme !== "file") throw new Error("请先打开已保存的本地代码文件。")
    if (!vscode.workspace.isTrusted) throw new Error("请先信任工作区。")
    if (!editor.selection.isEmpty) throw new Error("请取消选区，将光标留在最近编辑的位置。")
    const previous = this.active
    if (!previous && !this.host.completionContext().ready) throw new Error("请先连接 CodeM，并等待当前生成结束。")
    this.clear()
    const version = editor.document.version, scope = this.host.contextKey(), position = editor.selection.active
    let settle!: () => void
    const operation: Generation = { editor, version, abort: new AbortController(), settled: new Promise(resolve => { settle = resolve }) }
    this.active = operation; this.render()
    const started = performance.now()
    let calls = 0, outcome = "cancelled", timedOut = false
    const deadline = setTimeout(() => { timedOut = true; operation.abort.abort(); this.render() }, 15000)
    const current = () => !this.disposed && !operation.abort.signal.aborted && vscode.workspace.isTrusted && !editor.document.isClosed && editor.document.version === version && vscode.window.activeTextEditor === editor && editor.selection.isEmpty && editor.selection.active.isEqual(position)
    try {
      await previous?.settled
      if (!current() || scope !== this.host.contextKey()) return
      if (!this.host.completionContext().ready) throw new Error("当前连接忙碌，请稍后重新预测。")
      await this.host.assertContextWorkspace(editor.document.uri.fsPath)
      if (!current() || scope !== this.host.contextKey()) return
      this.observe()
      if (!this.observed) throw new Error("Next Edit 暂支持不超过 100000 字符的本地文件。")
      const first = Math.max(0, position.line - 40), last = Math.min(editor.document.lineCount - 1, position.line + 40)
      const range = new vscode.Range(new vscode.Position(first, 0), editor.document.lineAt(last).range.end)
      const context: NextEditContext = { language: editor.document.languageId, firstLine: first + 1, source: editor.document.getText(range), cursorLine: position.line + 1, recent: this.recent, diagnostics: vscode.languages.getDiagnostics(editor.document.uri).filter(d => d.range.start.line >= first && d.range.start.line <= last).slice(0, 6).map(d => `Line ${d.range.start.line + 1}: ${d.message}`) }
      const prompt = nextEditPrompt(context)
      calls++
      const raw = await this.host.generateText(prompt, operation.abort.signal, scope)
      if (!current()) return
      const edit = parseNextEdit(raw, context, editor.document.offsetAt(range.start))
      outcome = edit ? "suggestion" : "empty"
      if (!edit) { void vscode.window.showInformationMessage("没有明确的下一处修改建议。"); return }
      this.suggestion = { id: randomUUID(), editor, version, key: this.host.completionContext().key, edit, jumped: false }
    } catch (error) { if (!operation.abort.signal.aborted) { outcome = "failed"; throw error } }
    finally {
      clearTimeout(deadline)
      if (this.active === operation) { this.active = null; this.render() }
      settle()
      if (timedOut && !this.disposed) { outcome = "timeout"; void vscode.window.showWarningMessage("Next Edit 等待超过 15 秒，已取消，请稍后重试。") }
      this.log(`Next Edit: ${outcome}, ${Math.round(performance.now() - started)}ms, generationCalls=${calls}`)
    }
  }
  private require(id?: string): Suggestion {
    const suggestion = this.suggestion
    if (!suggestion || id !== undefined && suggestion.id !== id) throw new Error("Next Edit 建议已结束或失效。")
    if (!this.valid(suggestion)) { this.clear(); throw new Error("代码或会话已变化，请重新预测。") }
    if (this.applying || !this.host.completionContext().ready) throw new Error("请等待当前操作结束。")
    if (suggestion.editor.document.getText(this.range(suggestion)) !== suggestion.edit.before) { this.clear(); throw new Error("修改原文已变化，请重新预测。") }
    return suggestion
  }
  private jump(id?: string): void {
    const suggestion = this.require(id), range = this.range(suggestion)
    suggestion.jumped = true
    suggestion.editor.selection = new vscode.Selection(range.start, range.start)
    suggestion.editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport)
    this.render()
  }
  private async accept(id?: string): Promise<void> {
    const suggestion = this.require(id)
    await this.host.assertContextWorkspace(suggestion.editor.document.uri.fsPath)
    this.require(suggestion.id)
    this.applying = true; this.render()
    try {
      const applied = await suggestion.editor.edit(builder => builder.replace(this.range(suggestion), suggestion.edit.after), { undoStopBefore: true, undoStopAfter: true })
      if (!applied) throw new Error("编辑器未能应用 Next Edit，请重试。")
      this.suggestion = null
      this.recent = null; this.observe()
    } finally { this.applying = false; this.render() }
  }
  dispose(): void {
    if (this.disposed) return
    this.clear(); this.disposed = true; this.observed = null; this.recent = null
    for (const key of ["codem.nextEditVisible", "codem.nextEditAtTarget", "codem.nextEditBusy"]) void vscode.commands.executeCommand("setContext", key, false)
    for (const subscription of this.subscriptions) subscription.dispose()
  }
}
