import * as vscode from "vscode"
import type { AppServerInteraction, AppServerInteractionResponse } from "@codem/app-server"

/** Native controls keep approval requests outside the untrusted webview message surface. */
export async function showInteraction(request: AppServerInteraction, signal: AbortSignal): Promise<AppServerInteractionResponse | null> {
  const source = new vscode.CancellationTokenSource()
  const cancel = () => source.cancel()
  signal.addEventListener("abort", cancel, { once: true })
  if (signal.aborted) source.cancel()
  try {
    if (request.kind === "permission") {
      const preview = request.preview
      const detail = preview.kind === "bash_command" ? preview.command : preview.kind === "file_write" ? `${preview.path}\n${preview.diffExcerpt ?? preview.changeSummary}` : preview.kind === "file_read" ? preview.path : preview.kind === "web_fetch" ? preview.url : preview.kind === "web_search" ? preview.query : preview.kind === "mcp" ? `${preview.server}: ${preview.originalTool}\n${preview.argsRedacted}` : preview.summary
      const choice = await vscode.window.showQuickPick(request.options.map((option) => ({ label: option.label, id: option.id, detail })), { title: `CodeM · ${request.toolName}`, placeHolder: request.reason, ignoreFocusOut: true }, source.token)
      return choice ? { kind: "permission", optionId: choice.id } : null
    }
    if (request.kind === "question") {
      const answers: { question: string; selected: string[]; freeText: string | null }[] = []
      for (const question of request.questions) {
        const custom = { label: "输入其他回答…", custom: true }
        const choices = [...question.options.map((option) => ({ label: option.label, description: option.description, detail: option.preview ?? undefined, custom: false })), custom]
        const selected = question.allowsMultipleSelection
          ? await vscode.window.showQuickPick(choices, { title: question.header, placeHolder: question.question, canPickMany: true, ignoreFocusOut: true }, source.token)
          : await vscode.window.showQuickPick(choices, { title: question.header, placeHolder: question.question, ignoreFocusOut: true }, source.token).then((item) => item ? [item] : undefined)
        if (!selected) return { kind: "question", cancelled: true }
        let freeText: string | null = null
        if (selected.some((item) => item.custom)) {
          const value = await vscode.window.showInputBox({ title: question.question, ignoreFocusOut: true, validateInput: (text) => text.trim() ? null : "请输入回答" }, source.token)
          if (value === undefined) return { kind: "question", cancelled: true }
          freeText = value
        }
        answers.push({ question: question.question, selected: selected.filter((item) => !item.custom).map((item) => item.label), freeText })
      }
      return { kind: "question", cancelled: false, answers }
    }
    if (request.kind === "rewind") {
      // Rewind is not exposed by this first client. Never choose a destructive checkpoint implicitly.
      return { kind: "rewind", cancelled: true }
    }
    const choice = await vscode.window.showQuickPick([
      { label: "同意", approved: true, detail: request.kind === "plan" ? request.plan : "允许进入计划模式" },
      { label: "拒绝", approved: false },
    ], { title: request.kind === "plan" ? "CodeM · 审阅计划" : "CodeM · 进入计划模式", ignoreFocusOut: true }, source.token)
    return { kind: request.kind, approved: choice?.approved ?? false }
  } finally {
    signal.removeEventListener("abort", cancel)
    source.dispose()
  }
}
