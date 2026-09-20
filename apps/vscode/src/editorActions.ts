import * as vscode from "vscode"
import { codePrompt, type EditorAction } from "./editorContext.ts"
import { assertTrusted } from "./runtimeSession.ts"

export function registerEditorActions(addContext: (text: string, uri: vscode.Uri) => Promise<void>): vscode.Disposable {
  const actions: readonly EditorAction[] = ["addToContext", "explainCode", "fixCode", "improveCode"]
  const titles = { addToContext: "加入 CodeM 上下文", explainCode: "使用 CodeM 解释代码", fixCode: "使用 CodeM 修复代码", improveCode: "使用 CodeM 改进代码" }
  const run = async (action: EditorAction, uri?: vscode.Uri, range?: vscode.Range, version?: number) => {
    assertTrusted()
    const editor = vscode.window.activeTextEditor
    const document = uri ? await vscode.workspace.openTextDocument(uri) : editor?.document
    if (!document || (document.uri.scheme !== "file" && document.uri.scheme !== "untitled")) throw new Error("请打开可编辑的代码文件。")
    if (version !== undefined && document.version !== version) throw new Error("代码已变化，请重新选择操作。")
    const selected = range ?? editor?.selection
    if (!selected || selected.isEmpty) throw new Error("请先选择要处理的代码。")
    const text = codePrompt(action, { path: vscode.workspace.asRelativePath(document.uri, true), language: document.languageId, startLine: selected.start.line + 1, endLine: selected.end.line + 1, text: document.getText(selected), diagnostics: vscode.languages.getDiagnostics(document.uri).filter(item => item.range.intersection(selected)).slice(0, 20).map(item => `第 ${item.range.start.line + 1} 行：${item.message.slice(0, 500)}`) })
    await addContext(text, document.uri)
  }
  return vscode.Disposable.from(
    ...actions.map(action => vscode.commands.registerCommand(`codem.${action}`, async (uri?: vscode.Uri, range?: vscode.Range, version?: number) => {
      try { await run(action, uri, range, version) } catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "代码操作失败。") }
    })),
    vscode.languages.registerCodeActionsProvider([{ scheme: "file" }, { scheme: "untitled" }], {
      provideCodeActions(document, range, context) {
        if (!vscode.workspace.isTrusted) return []
        const selected = range.isEmpty ? context.diagnostics[0]?.range : range
        if (!selected || selected.isEmpty) return []
        return actions.filter(action => action !== "addToContext").map(action => {
          const result = new vscode.CodeAction(titles[action], action === "fixCode" ? vscode.CodeActionKind.QuickFix : vscode.CodeActionKind.RefactorRewrite)
          result.command = { title: titles[action], command: `codem.${action}`, arguments: [document.uri, selected, document.version] }
          if (action === "fixCode") result.diagnostics = [...context.diagnostics]
          return result
        })
      },
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite] }),
  )
}
