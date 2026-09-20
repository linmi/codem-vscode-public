import * as vscode from "vscode"
import { completionPrompt, generatedText } from "./editorGeneration.ts"
import type { ChatController } from "../chat/chatController.ts"
import { assertTrusted } from "../connection/runtimeSession.ts"

export function registerInlineCompletion(chat: ChatController, log: (message: string) => void): vscode.Disposable {
  let active: AbortController | null = null
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10)
  status.command = "codem.cancelCompletion"
  const cancel = () => active?.abort()
  const provider = vscode.languages.registerInlineCompletionItemProvider({ scheme: "file" }, {
    async provideInlineCompletionItems(document, position, context, token) {
      if (!vscode.workspace.isTrusted || !vscode.workspace.getConfiguration("codem", document.uri).get<boolean>("completion.enabled", true) || context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke || token.isCancellationRequested) return []
      if (active) return []
      const editor = vscode.window.activeTextEditor
      if (editor?.document !== document || !editor.selection.isEmpty || !editor.selection.active.isEqual(position)) return []
      const abort = new AbortController(); active = abort
      const subscription = token.onCancellationRequested(() => abort.abort())
      const scope = chat.contextKey()
      const version = document.version
      const started = performance.now()
      status.text = "$(loading~spin) CodeM 补全"; status.tooltip = "点击取消补全"; status.show()
      try {
        assertTrusted(); await chat.assertContextWorkspace(document.uri.fsPath)
        abort.signal.throwIfAborted()
        const offset = document.offsetAt(position)
        const prefix = document.getText(new vscode.Range(document.positionAt(Math.max(0, offset - 8000)), position))
        const suffix = document.getText(new vscode.Range(position, document.positionAt(offset + 4000)))
        const response = await chat.generateText(completionPrompt(document.languageId, prefix, suffix), abort.signal, scope)
        if (abort.signal.aborted || token.isCancellationRequested || document.isClosed || document.version !== version || vscode.window.activeTextEditor !== editor || !editor.selection.active.isEqual(position) || !editor.selection.isEmpty) return []
        const insertion = generatedText(response, "insertText")
        return [new vscode.InlineCompletionItem(insertion, new vscode.Range(position, position))]
      } catch (error) {
        if (!abort.signal.aborted && !token.isCancellationRequested) void vscode.window.showWarningMessage(error instanceof Error ? error.message : "CodeM 补全失败，请重试。")
        return []
      } finally {
        log(`Inline completion: ${Math.round(performance.now() - started)}ms`)
        subscription.dispose(); if (active === abort) active = null; status.hide()
      }
    },
  })
  return vscode.Disposable.from(provider, status,
    { dispose: cancel },
    vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) cancel() }),
    vscode.window.onDidChangeActiveTextEditor(cancel),
    vscode.window.onDidChangeTextEditorSelection(cancel),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("codem.completion.enabled")) cancel() }),
    vscode.commands.registerCommand("codem.generateCompletion", async () => {
      if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage("请先信任工作区。"); return }
      if (!vscode.workspace.getConfiguration("codem", vscode.window.activeTextEditor?.document.uri).get<boolean>("completion.enabled", true)) { void vscode.window.showWarningMessage("请先在 CodeM 设置中启用行内补全。"); return }
      if (chat.snapshot().phase !== "ready") { void vscode.window.showWarningMessage("请先连接 CodeM，并等待当前任务结束。"); return }
      await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
    }),
    vscode.commands.registerCommand("codem.cancelCompletion", async () => { cancel(); await vscode.commands.executeCommand("editor.action.inlineSuggest.hide") }),
  )
}
