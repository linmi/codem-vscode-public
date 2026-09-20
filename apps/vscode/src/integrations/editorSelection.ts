import * as vscode from "vscode"
import { SelectedCodeState } from "../resources/selectedCode.ts"
import type { CodeSelectionView } from "../shared/messages.ts"
import { assertTrusted } from "../connection/runtimeSession.ts"

/** Observes local editor events only; focusing the chat retains the last selected source. */
export class EditorSelection implements vscode.Disposable {
  readonly state: SelectedCodeState
  private readonly subscriptions: vscode.Disposable[]
  constructor(changed: (view: CodeSelectionView | null) => void) {
    this.state = new SelectedCodeState(changed)
    this.subscriptions = [
      vscode.window.onDidChangeTextEditorSelection(event => { if (event.textEditor === vscode.window.activeTextEditor) this.capture(event.textEditor) }),
      vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) this.capture(editor) }),
      vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) this.state.invalidate(event.document.uri.toString()) }),
      vscode.workspace.onDidCloseTextDocument(document => this.state.invalidate(document.uri.toString())),
    ]
    if (vscode.window.activeTextEditor) this.capture(vscode.window.activeTextEditor)
  }
  private capture(editor: vscode.TextEditor): void {
    const { document, selection } = editor
    if (!vscode.workspace.isTrusted || !["file", "untitled"].includes(document.uri.scheme) || selection.isEmpty) { this.state.capture(null); return }
    const uri = document.uri.toString()
    const start = { line: selection.start.line, character: selection.start.character }
    const end = { line: selection.end.line, character: selection.end.character }
    this.state.capture({ key: JSON.stringify([uri, document.version, start, end]), uri, version: document.version, start, end, context: {
      path: vscode.workspace.getWorkspaceFolder(document.uri) ? vscode.workspace.asRelativePath(document.uri, true) : document.fileName.split(/[\\/]/).at(-1)!, language: document.languageId,
      startLine: start.line + 1, endLine: end.line + (end.character === 0 && end.line > start.line ? 0 : 1),
      text: document.getText(selection), diagnostics: [],
    } })
  }
  async reveal(id: string): Promise<void> {
    const source = this.state.read(id)
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(source.uri))
    if (document.version !== source.version) { this.state.invalidate(source.uri); throw new Error("代码已变化，请重新选择。") }
    const selection = new vscode.Range(source.start.line, source.start.character, source.end.line, source.end.character)
    await vscode.window.showTextDocument(document, { selection, preview: true })
  }
  async send(text: string, id: string | undefined, send: (text: string) => Promise<boolean>, validate: (path: string) => Promise<void>): Promise<boolean> {
    if (!id) return send(text)
    assertTrusted()
    const source = this.state.read(id)
    const uri = vscode.Uri.parse(source.uri)
    if (uri.scheme === "file") await validate(uri.fsPath)
    const accepted = await send(this.state.prompt(id, text))
    if (accepted) this.state.remove(id)
    return accepted
  }
  dispose(): void { for (const subscription of this.subscriptions) subscription.dispose(); this.state.clear() }
}
