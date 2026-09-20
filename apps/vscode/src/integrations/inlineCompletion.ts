import * as vscode from "vscode"
import { completionPrompt, generatedText } from "./editorGeneration.ts"
import type { ChatController } from "../chat/chatController.ts"
import { assertTrusted } from "../connection/runtimeSession.ts"

type CompletionChat = Pick<ChatController, "snapshot" | "contextKey" | "assertContextWorkspace" | "generateText">
type Request = { abort: AbortController; settled: Promise<void>; document: vscode.TextDocument }
const automaticDelayMs = 600

/** One owner for pending debounce, generation and cancellation, scoped to this extension host. */
export function registerInlineCompletion(chat: CompletionChat, log: (message: string) => void): vscode.Disposable {
  let active: Request | null = null
  let disposed = false
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10)
  status.command = "codem.cancelCompletion"
  const cancel = () => active?.abort.abort()
  const enabled = (document: vscode.TextDocument) => vscode.workspace.getConfiguration("codem", document.uri).get<boolean>("completion.enabled", true)
  const idle = () => { const state = chat.snapshot(); return state.phase === "ready" && !state.backgroundBusy && !state.sessionTools.busy }
  const provider = vscode.languages.registerInlineCompletionItemProvider({ scheme: "file" }, {
    async provideInlineCompletionItems(document, position, context, token) {
      const automatic = context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic
      if (disposed || !vscode.workspace.isTrusted || !enabled(document) || token.isCancellationRequested) return []
      if (automatic && !vscode.workspace.getConfiguration("codem", document.uri).get<boolean>("completion.autoTrigger", true)) return []
      const editor = vscode.window.activeTextEditor
      if (editor?.document !== document || !editor.selection.isEmpty || !editor.selection.active.isEqual(position)) return []
      // Keep the old request's settlement in the chain: abort is not a Core terminal event.
      const previous = active
      if (!previous && !idle()) return []
      previous?.abort.abort()
      const abort = new AbortController()
      let settle!: () => void
      const request: Request = { abort, document, settled: new Promise<void>(resolve => { settle = resolve }) }
      active = request
      const subscription = token.onCancellationRequested(() => abort.abort())
      if (token.isCancellationRequested) abort.abort()
      const scope = chat.contextKey(), version = document.version
      const valid = () => !disposed && !abort.signal.aborted && !token.isCancellationRequested && !document.isClosed && document.version === version && vscode.workspace.isTrusted && enabled(document) && vscode.window.activeTextEditor === editor && editor.selection.isEmpty && editor.selection.active.isEqual(position)
      const started = performance.now()
      let generationCalls = 0
      try {
        if (automatic) await delay(automaticDelayMs, abort.signal)
        if (previous) await previous.settled
        if (!valid() || scope !== chat.contextKey() || !idle()) return []
        status.text = "$(loading~spin) CodeM 补全"; status.tooltip = "点击取消补全"; status.show()
        assertTrusted(); await chat.assertContextWorkspace(document.uri.fsPath)
        if (!valid() || scope !== chat.contextKey()) return []
        // VS Code only displays a suggestion-widget preview when range and prefix match.
        const selected = context.selectedCompletionInfo
        const range = selected?.range ?? new vscode.Range(position, position)
        const start = document.offsetAt(range.start), end = document.offsetAt(range.end)
        const prefix = document.getText(new vscode.Range(document.positionAt(Math.max(0, start - 8000)), range.start)) + (selected?.text ?? "")
        const suffix = document.getText(new vscode.Range(range.end, document.positionAt(end + 4000)))
        generationCalls++
        const response = await chat.generateText(completionPrompt(document.languageId, prefix, suffix), abort.signal, scope)
        if (!valid()) return []
        const insertion = (selected?.text ?? "") + generatedText(response, "insertText")
        return [new vscode.InlineCompletionItem(insertion, range)]
      } catch (error) {
        if (!abort.signal.aborted && !token.isCancellationRequested) {
          log(`Inline completion failed (${automatic ? "automatic" : "manual"}): ${error instanceof Error ? error.message : "unknown error"}`)
          if (!automatic) void vscode.window.showWarningMessage(error instanceof Error ? error.message : "CodeM 补全失败，请重试。")
        }
        return []
      } finally {
        log(`Inline completion (${automatic ? "automatic" : "manual"}): ${Math.round(performance.now() - started)}ms, generationCalls=${generationCalls}`)
        subscription.dispose()
        if (active === request) { active = null; status.hide() }
        settle()
      }
    },
  })
  return vscode.Disposable.from(provider, status,
    { dispose() { disposed = true; cancel() } },
    vscode.workspace.onDidChangeTextDocument(event => { if (event.document === active?.document && event.contentChanges.length) cancel() }),
    vscode.window.onDidChangeActiveTextEditor(cancel),
    vscode.window.onDidChangeTextEditorSelection(event => { if (event.textEditor.document === active?.document) cancel() }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("codem.completion")) cancel() }),
    vscode.commands.registerCommand("codem.generateCompletion", async () => {
      const editor = vscode.window.activeTextEditor
      if (!editor || editor.document.uri.scheme !== "file") { void vscode.window.showWarningMessage("请先打开已保存的本地代码文件，再触发行内补全。"); return }
      if (!editor.selection.isEmpty) { void vscode.window.showWarningMessage("请取消文本选区，将光标放在要补全的位置。"); return }
      if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage("请先信任工作区。"); return }
      if (!enabled(editor.document)) { void vscode.window.showWarningMessage("请先在 CodeM 设置中启用行内补全。"); return }
      if (!active && !idle()) { void vscode.window.showWarningMessage("请先连接 CodeM，并等待当前任务结束。"); return }
      await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
    }),
    vscode.commands.registerCommand("codem.cancelCompletion", async () => { cancel(); await vscode.commands.executeCommand("editor.action.inlineSuggest.hide") }),
  )
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve() }
    const timer = setTimeout(finish, ms)
    signal.addEventListener("abort", finish, { once: true })
    if (signal.aborted) finish()
  })
}
