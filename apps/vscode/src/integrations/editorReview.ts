import * as vscode from "vscode"
import { randomUUID } from "node:crypto"
import { EditProposal, editPrompt, type ProposedEdit } from "./editProposal.ts"
import { assertTrusted } from "../connection/runtimeSession.ts"

interface ReviewHost {
  contextKey(): string
  ready(): boolean
  checkFile(path: string): Promise<void>
  generate(text: string, signal: AbortSignal, scope: string): Promise<string>
}
interface Review {
  id: string; document: vscode.TextDocument; version: number; scope: string; proposal: EditProposal
  beforeUri: vscode.Uri; afterUri: vscode.Uri; applying: boolean; expected: string | null
}

/** Owns only unapplied editor suggestions; Core's already-written changes are never rolled back. */
export class EditorReview implements vscode.Disposable {
  private review: Review | null = null
  private generation: { abort: AbortController; document: vscode.TextDocument; version: number } | null = null
  private disposed = false
  private readonly changes = new vscode.EventEmitter<vscode.Uri>()
  private readonly lenses = new vscode.EventEmitter<void>()
  private readonly decoration = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"), isWholeLine: true, overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.modifiedForeground"), overviewRulerLane: vscode.OverviewRulerLane.Right })
  private readonly subscriptions: vscode.Disposable[]
  constructor(private readonly host: ReviewHost, private readonly log: (message: string) => void) {
    const run = (fn: (...args: string[]) => Promise<void>) => (...args: string[]) => fn(...args).catch(error => this.report(error))
    this.subscriptions = [this.changes, this.lenses, this.decoration,
      vscode.workspace.registerTextDocumentContentProvider("codem-edit-review", { onDidChange: this.changes.event, provideTextDocumentContent: uri => {
        const review = this.review
        if (!review) return "此修改建议已结束。"
        return uri.toString() === review.beforeUri.toString() ? review.proposal.source() : uri.toString() === review.afterUri.toString() ? review.proposal.preview() : "此修改建议已失效。"
      } }),
      vscode.languages.registerCodeLensProvider({ scheme: "file" }, { onDidChangeCodeLenses: this.lenses.event, provideCodeLenses: document => {
        const review = this.review
        if (!review || review.document !== document || review.applying) return []
        return review.proposal.pending.flatMap(edit => {
          const range = this.range(review, edit)
          return [new vscode.CodeLens(range, { title: `CodeM · ${edit.reason}`, command: "codem.previewEdit", arguments: [review.id, edit.id] }),
            new vscode.CodeLens(range, { title: "接受", command: "codem.acceptEdit", arguments: [review.id, edit.id] }),
            new vscode.CodeLens(range, { title: "拒绝", command: "codem.rejectEdit", arguments: [review.id, edit.id] })]
        })
      } }),
      vscode.commands.registerCommand("codem.previewEdit", run((id, edit) => this.preview(id!, edit!))),
      vscode.commands.registerCommand("codem.acceptEdit", run((id, edit) => this.decide(id!, [edit!], true))),
      vscode.commands.registerCommand("codem.rejectEdit", run((id, edit) => this.decide(id!, [edit!], false))),
      vscode.commands.registerCommand("codem.acceptAllEdits", run(async () => { const review = this.require(); await this.decide(review.id, review.proposal.pending.map(edit => edit.id), true) })),
      vscode.commands.registerCommand("codem.rejectAllEdits", run(async () => { const review = this.require(); await this.decide(review.id, review.proposal.pending.map(edit => edit.id), false) })),
      vscode.commands.registerCommand("codem.reviewEdits", run(() => this.pick())),
      vscode.commands.registerCommand("codem.acceptCurrentEdit", run(() => this.decideCurrent(true))),
      vscode.commands.registerCommand("codem.rejectCurrentEdit", run(() => this.decideCurrent(false))),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.generation?.document === event.document && event.document.version !== this.generation.version) this.generation.abort.abort()
        const review = this.review
        if (!review || event.document !== review.document || !event.contentChanges.length) return
        if (event.document.version === review.version && event.document.getText() === review.proposal.source()) return
        if (review.applying && event.document.getText() === review.expected) review.version = event.document.version
        else this.clear("代码已变化，剩余修改建议已失效，请重新生成。")
      }),
      vscode.workspace.onDidCloseTextDocument(document => {
        if (this.generation?.document === document) this.generation.abort.abort()
        if (this.review?.document === document) this.clear()
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { this.generation?.abort.abort(); this.clear() }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate()),
    ]
  }
  contextChanged(): void {
    const review = this.review
    if (review && review.scope !== this.host.contextKey()) this.clear("会话已变化，剩余修改建议已失效。")
  }
  async generate(action: "fixCode" | "improveCode", document: vscode.TextDocument, range: vscode.Range, diagnostics: readonly string[]): Promise<void> {
    assertTrusted()
    if (document.uri.scheme !== "file") throw new Error("请先将代码保存为工作区文件，再生成修改建议。")
    if (this.generation) throw new Error("正在生成修改建议，请等待或在进度通知中取消。")
    if (this.review) { await this.pick(); return }
    if (!this.host.ready()) throw new Error("请先连接 CodeM，并等待当前任务结束。")
    const original = document.getText(), version = document.version
    const start = document.offsetAt(range.start), end = document.offsetAt(range.end)
    const prompt = editPrompt(action, document.languageId, original.slice(start, end), original.slice(Math.max(0, start - 2000), start), original.slice(end, end + 2000), diagnostics)
    const operation = { abort: new AbortController(), document, version }
    this.generation = operation
    const scope = this.host.contextKey(), started = performance.now()
    try {
      await this.host.checkFile(document.uri.fsPath)
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "CodeM 正在生成修改建议", cancellable: true }, async (_, token) => {
        const cancel = token.onCancellationRequested(() => operation.abort.abort())
        try {
          if (token.isCancellationRequested) operation.abort.abort()
          operation.abort.signal.throwIfAborted()
          const raw = await this.host.generate(prompt, operation.abort.signal, scope)
          operation.abort.signal.throwIfAborted(); assertTrusted()
          if (this.disposed || document.isClosed || document.version !== version || document.getText() !== original) throw new Error("代码已变化，修改建议未应用，请重新生成。")
          const proposal = new EditProposal(original, start, end, raw)
          if (!proposal.pending.length) { void vscode.window.showInformationMessage("CodeM 未发现需要修改的内容。"); return }
          const id = randomUUID(), name = document.uri.path.split("/").at(-1)!
          this.review = { id, document, version, scope: this.host.contextKey(), proposal, applying: false, expected: null,
            beforeUri: vscode.Uri.from({ scheme: "codem-edit-review", path: `/${id}/before/${name}` }), afterUri: vscode.Uri.from({ scheme: "codem-edit-review", path: `/${id}/after/${name}` }) }
          this.refresh()
          await vscode.window.showTextDocument(document, { preview: false, selection: range })
          void vscode.window.showInformationMessage(`已生成 ${proposal.pending.length} 处修改建议，可在代码上方逐块预览、接受或拒绝。`)
        } finally { cancel.dispose() }
      })
    } catch (error) { if (!operation.abort.signal.aborted) throw error }
    finally { if (this.generation === operation) this.generation = null; this.log(`Editor proposal: ${Math.round(performance.now() - started)}ms`) }
  }
  private require(id?: string): Review {
    assertTrusted()
    const review = this.review
    if (!review || (id !== undefined && id !== review.id)) throw new Error("修改建议已结束或失效。")
    if (review.applying) throw new Error("正在应用修改，请稍候。")
    if (review.document.isClosed || review.document.version !== review.version || review.document.getText() !== review.proposal.source() || review.scope !== this.host.contextKey()) {
      this.clear(); throw new Error("代码或会话已变化，请重新生成修改建议。")
    }
    if (!this.host.ready()) throw new Error("请等待当前任务结束后继续审阅修改建议。")
    return review
  }
  private range(review: Review, edit: ProposedEdit): vscode.Range {
    const start = review.proposal.offset(edit)
    return new vscode.Range(review.document.positionAt(start), review.document.positionAt(start + edit.before.length))
  }
  private async decide(id: string, ids: string[], accept: boolean): Promise<void> {
    const review = this.require(id)
    const edits = ids.map(key => review.proposal.pending.find(edit => edit.id === key))
    if (!ids.length || edits.some(edit => !edit) || new Set(ids).size !== ids.length) throw new Error("修改块已处理或失效。")
    if (!accept) { review.proposal.choose(ids, "rejected"); this.finished(review); return }
    await this.host.checkFile(review.document.uri.fsPath)
    this.require(id)
    const change = new vscode.WorkspaceEdit()
    let expected = review.proposal.source()
    for (const edit of [...edits].reverse()) {
      const offset = review.proposal.offset(edit!)
      expected = expected.slice(0, offset) + edit!.after + expected.slice(offset + edit!.before.length)
    }
    for (const edit of edits) change.replace(review.document.uri, this.range(review, edit!), edit!.after)
    review.applying = true; review.expected = expected; this.lenses.fire()
    try {
      const applied = await vscode.workspace.applyEdit(change)
      if (this.review !== review) throw new Error("应用期间代码发生变化，剩余建议已失效；请检查当前文件。")
      if (!applied) throw new Error("编辑器未能应用修改，请重试。")
      if (review.document.getText() !== expected) { this.clear(); throw new Error("应用结果与建议不一致，请检查当前文件。") }
      review.version = review.document.version
      review.proposal.choose(ids, "accepted")
      this.finished(review)
    } finally { review.applying = false; review.expected = null; this.refresh() }
  }
  private finished(review: Review): void {
    if (!review.proposal.pending.length) this.clear()
    else this.refresh()
  }
  private async preview(id: string, editId: string): Promise<void> {
    const review = this.require(id), edit = review.proposal.pending.find(item => item.id === editId)
    if (!edit) throw new Error("修改块已处理或失效。")
    const document = await vscode.workspace.openTextDocument(review.afterUri)
    this.require(id)
    await vscode.languages.setTextDocumentLanguage(document, review.document.languageId)
    this.require(id)
    await vscode.commands.executeCommand("vscode.diff", review.beforeUri, review.afterUri, `CodeM 修改建议 · ${vscode.workspace.asRelativePath(review.document.uri)}`, { preview: true, selection: new vscode.Range(document.positionAt(review.proposal.previewOffset(edit)), document.positionAt(review.proposal.previewOffset(edit) + edit.after.length)) })
  }
  private async pick(): Promise<void> {
    const review = this.require()
    const choice = await vscode.window.showQuickPick(review.proposal.pending.map(edit => ({ label: `第 ${review.document.positionAt(review.proposal.offset(edit)).line + 1} 行 · ${edit.reason}`, edit })), { title: "CodeM · 审阅修改建议" })
    if (!choice) return
    this.require(review.id)
    const action = await vscode.window.showQuickPick([{ label: "预览差异", id: "preview" }, { label: "接受此处", id: "accept" }, { label: "拒绝此处", id: "reject" }], { title: choice.label })
    if (!action) return
    if (action.id === "preview") await this.preview(review.id, choice.edit.id)
    else await this.decide(review.id, [choice.edit.id], action.id === "accept")
  }
  private async decideCurrent(accept: boolean): Promise<void> {
    const review = this.require(), editor = vscode.window.activeTextEditor
    if (!editor) throw new Error("请将光标放在要处理的修改块中。")
    const uri = editor.document.uri.toString()
    const proposed = uri === review.afterUri.toString()
    if (!proposed && uri !== review.beforeUri.toString() && editor.document !== review.document) throw new Error("请先打开 CodeM 修改建议。")
    const matches = review.proposal.pending.filter(edit => {
      const offset = proposed ? review.proposal.previewOffset(edit) : review.proposal.offset(edit)
      const start = editor.document.positionAt(offset).line
      const end = editor.document.positionAt(offset + (proposed ? edit.after.length : edit.before.length)).line
      return editor.selection.active.line >= start && editor.selection.active.line <= end
    })
    const edit = matches.length === 1 ? matches[0] : (await vscode.window.showQuickPick((matches.length ? matches : review.proposal.pending).map(item => ({ label: item.reason, edit: item })), { title: accept ? "选择要接受的修改" : "选择要拒绝的修改" }))?.edit
    if (edit) await this.decide(review.id, [edit.id], accept)
  }
  private refresh(): void { this.lenses.fire(); if (this.review) { this.changes.fire(this.review.beforeUri); this.changes.fire(this.review.afterUri) }; this.decorate() }
  private decorate(): void {
    for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(this.decoration, this.review?.document === editor.document ? this.review.proposal.pending.map(edit => {
      const hover = new vscode.MarkdownString().appendText(edit.reason).appendCodeblock(edit.after || "（删除此处）", editor.document.languageId)
      return { range: this.range(this.review!, edit), hoverMessage: hover }
    }) : [])
  }
  private clear(message?: string): void {
    const review = this.review; this.review = null
    this.refresh()
    if (review) { this.changes.fire(review.beforeUri); this.changes.fire(review.afterUri) }
    if (message) void vscode.window.showInformationMessage(message)
  }
  private report(error: unknown): void { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "修改审阅失败，请重试。") }
  dispose(): void { this.disposed = true; this.generation?.abort.abort(); this.clear(); for (const disposable of this.subscriptions) disposable.dispose() }
}
