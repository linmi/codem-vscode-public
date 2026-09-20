import * as vscode from "vscode"
import { randomUUID } from "node:crypto"
import type { PanelInput } from "../panels/panelBroker.ts"

/** Reuse the same interaction-to-panel semantics; only the native presentation differs. */
export class NativeChatPanels implements vscode.Disposable {
  private readonly documents = new Map<string, string>()
  private readonly provider = vscode.workspace.registerTextDocumentContentProvider("codem-native-review", {
    provideTextDocumentContent: uri => this.documents.get(uri.toString()) ?? "预览已关闭。",
  })
  private readonly closed = vscode.workspace.onDidCloseTextDocument(document => this.documents.delete(document.uri.toString()))
  dispose(): void { this.provider.dispose(); this.closed.dispose(); this.documents.clear() }
  async request<T>(input: PanelInput<T>, signal?: AbortSignal): Promise<{ values: T[]; text: string } | null> {
    if (signal?.aborted) return null
    const cancellation = new vscode.CancellationTokenSource()
    const cancel = () => cancellation.cancel()
    signal?.addEventListener("abort", cancel, { once: true })
    try {
      // Full plans and approval previews must be reviewable before choosing an answer.
      if (input.detail) {
        const uri = vscode.Uri.from({ scheme: "codem-native-review", path: `/${randomUUID()}/review.txt` })
        this.documents.set(uri.toString(), input.detail)
        const document = await vscode.workspace.openTextDocument(uri)
        if (signal?.aborted) return null
        await vscode.window.showTextDocument(document, { preview: true, preserveFocus: true })
      }
      if (signal?.aborted) return null
      type Item = vscode.QuickPickItem & { answer: { kind: "choice"; value: T } | { kind: "text" } | { kind: "back"; value: T } }
      const items: Item[] = input.choices.map(choice => ({ label: choice.label, detail: choice.description, picked: choice.selected, answer: { kind: "choice", value: choice.value } }))
      if (input.allowText && input.kind === "question") items.push({ label: "填写文字回答", answer: { kind: "text" } })
      if (input.back) items.push({ label: "返回上一题", answer: { kind: "back", value: input.back.value } })
      const selected = await vscode.window.showQuickPick(items, { title: `CodeM · ${input.title}`, placeHolder: input.description, canPickMany: input.multiple ?? false, ignoreFocusOut: true }, cancellation.token)
      if (!selected || signal?.aborted) return null
      const selectedItems = Array.isArray(selected) ? selected : [selected]
      const back = selectedItems.find(item => item.answer.kind === "back")?.answer
      if (back?.kind === "back") return { values: [back.value], text: "" }
      const values = selectedItems.flatMap(item => item.answer.kind === "choice" ? [item.answer.value] : [])
      let text = ""
      if (selectedItems.some(item => item.answer.kind === "text") || (input.kind === "plan" && input.allowText && values[0] === false)) {
        const answer = await vscode.window.showInputBox({ title: input.kind === "plan" ? "计划反馈（可留空）" : input.title, prompt: input.description, value: input.initialText ?? "", ignoreFocusOut: true, validateInput: value => value.length > 16_000 ? "最多 16000 字符" : input.kind === "question" && !values.length && !value.trim() ? "请填写回答" : undefined }, cancellation.token)
        if (answer === undefined || signal?.aborted) return null
        text = answer.trim()
      }
      if (!values.length && !text) return null
      return { values, text }
    } finally { signal?.removeEventListener("abort", cancel); cancellation.dispose() }
  }
}
