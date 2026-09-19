import type { AppServerInteraction, AppServerInteractionResponse } from "@codem/app-server"
import type { PanelBroker } from "./panelBroker.ts"
import { displayPath } from "./filePresentation.ts"

/** Explicit display projection; no raw Core frame or request/option identity reaches Webview. */
export async function showInteraction(request: AppServerInteraction, signal: AbortSignal, panels: PanelBroker, cwd: string): Promise<AppServerInteractionResponse | null> {
  if (signal.aborted) return null
  if (request.kind === "permission") {
    const preview = request.preview
    const detail = preview.kind === "bash_command" ? preview.command : preview.kind === "file_write" ? `${displayPath(cwd, preview.path)}\n${preview.diffExcerpt ?? preview.changeSummary}` : preview.kind === "file_read" ? displayPath(cwd, preview.path) : preview.kind === "web_fetch" ? preview.url : preview.kind === "web_search" ? preview.query : preview.kind === "mcp" ? `${preview.server}: ${preview.originalTool}\n${preview.argsRedacted}` : preview.summary
    const answer = await panels.request({ kind: "approval", title: `允许 ${request.toolName}？`, description: request.reason, detail, choices: request.options.map(option => ({ value: option.id, label: option.label })) }, signal)
    return answer ? { kind: "permission", optionId: answer.values[0]! } : null
  }
  if (request.kind === "question") {
    const answers: { question: string; selected: string[]; freeText: string | null }[] = []
    const back = Symbol("previous question")
    for (let index = 0; index < request.questions.length;) {
      const question = request.questions[index]!
      const saved = answers[index]
      const answer = await panels.request<string | typeof back>({ kind: "question", ...(index > 0 ? { back: { value: back } } : {}), initialText: saved?.freeText ?? "", title: `${question.header} · ${index + 1}/${request.questions.length}`, description: question.question, multiple: question.allowsMultipleSelection, allowText: true, confirmLabel: index + 1 === request.questions.length ? "提交回答" : "下一步", choices: question.options.map(option => ({ value: option.label, label: option.label, selected: saved?.selected.includes(option.label) ?? false, description: [option.description, option.preview].filter(Boolean).join("\n") })) }, signal)
      if (!answer) return { kind: "question", cancelled: true }
      if (answer.values[0] === back) { index--; continue }
      answers[index] = { question: question.question, selected: answer.values.filter((value): value is string => typeof value === "string"), freeText: answer.text || null }
      index++
    }
    return { kind: "question", cancelled: false, answers }
  }
  if (request.kind === "rewind") return { kind: "rewind", cancelled: true }
  const answer = await panels.request({ kind: "plan", allowText: request.kind === "plan", title: request.kind === "plan" ? "审阅计划" : "进入计划模式？", detail: request.kind === "plan" ? request.plan : null, choices: [{ value: true, label: "同意", description: request.kind === "plan" ? "按计划继续" : "允许进入计划模式" }, { value: false, label: "拒绝" }] }, signal)
  return request.kind === "plan" ? { kind: "plan", approved: answer?.values[0] ?? false, ...(answer && !answer.values[0] && answer.text ? { feedback: answer.text } : {}) } : { kind: "plan-mode", approved: answer?.values[0] ?? false }
}
