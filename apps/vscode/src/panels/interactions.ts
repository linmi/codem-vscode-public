import type { AppServerInteraction, AppServerInteractionResponse } from "@codem/app-server"
import type { PanelBroker } from "./panelBroker.ts"
import { displayPath } from "../resources/filePresentation.ts"

/** Explicit display projection; no raw Core frame or request/option identity reaches Webview. */
export async function showInteraction(request: AppServerInteraction, signal: AbortSignal, panels: Pick<PanelBroker, "request">, cwd: string): Promise<AppServerInteractionResponse | null> {
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
  if (request.kind === "rewind") {
    const checkpoint = await panels.request({ kind: "rewind", title: "选择回退检查点", description: "选择要回到的记录；下一步选择代码、对话或两者。", choices: request.checkpoints.map(item => ({ value: item.id, label: item.label, description: `${item.createdAt ?? "时间未知"} · ${item.fileCount ?? "未知"} 个文件${item.warning ? " · 此检查点有 Core 警告，请谨慎选择" : ""}` })) }, signal)
    if (!checkpoint?.values[0]) return { kind: "rewind", cancelled: true }
    const mode = await panels.request({ kind: "rewind", title: "确认回退范围", description: "代码回退会改写检查点覆盖的文件。仅执行你选择的范围。", confirmLabel: "确认回退", choices: request.modes.map(value => ({ value, label: { code: "只回退代码", conversation: "只回退对话", both: "回退代码和对话" }[value] })) }, signal)
    return mode?.values[0] ? { kind: "rewind", cancelled: false, checkpointId: checkpoint.values[0], mode: mode.values[0] } : { kind: "rewind", cancelled: true }
  }
  const answer = await panels.request({ kind: "plan", allowText: request.kind === "plan", title: request.kind === "plan" ? "审阅计划" : "进入计划模式？", detail: request.kind === "plan" ? request.plan : null, choices: [{ value: true, label: "同意", description: request.kind === "plan" ? "按计划继续" : "允许进入计划模式" }, { value: false, label: "拒绝" }] }, signal)
  return request.kind === "plan" ? { kind: "plan", approved: answer?.values[0] ?? false, ...(answer && !answer.values[0] && answer.text ? { feedback: answer.text } : {}) } : { kind: "plan-mode", approved: answer?.values[0] ?? false }
}
