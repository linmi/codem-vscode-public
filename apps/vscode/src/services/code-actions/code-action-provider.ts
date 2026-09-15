import * as vscode from "vscode"

export class KiloCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite],
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (range.isEmpty) return []

    const actions: vscode.CodeAction[] = []

    const add = new vscode.CodeAction("Add to CodeM", vscode.CodeActionKind.RefactorRewrite)
    add.command = { command: "codem.addToContext", title: "Add to CodeM" }
    actions.push(add)

    const hasDiagnostics = context.diagnostics.length > 0

    if (hasDiagnostics) {
      const fix = new vscode.CodeAction("Fix with CodeM", vscode.CodeActionKind.QuickFix)
      fix.command = { command: "codem.fixCode", title: "Fix with CodeM" }
      fix.isPreferred = true
      actions.push(fix)
    }

    if (!hasDiagnostics) {
      const explain = new vscode.CodeAction("Explain with CodeM", vscode.CodeActionKind.RefactorRewrite)
      explain.command = { command: "codem.explainCode", title: "Explain with CodeM" }
      actions.push(explain)

      const improve = new vscode.CodeAction("Improve with CodeM", vscode.CodeActionKind.RefactorRewrite)
      improve.command = { command: "codem.improveCode", title: "Improve with CodeM" }
      actions.push(improve)
    }

    return actions
  }
}
