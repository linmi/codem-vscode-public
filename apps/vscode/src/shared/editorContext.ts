export type EditorAction = "addToContext" | "explainCode" | "fixCode" | "improveCode"
export interface CodeContext { path: string; language: string; startLine: number; endLine: number; text: string; diagnostics: readonly string[] }
export function codePrompt(action: EditorAction, context: CodeContext): string {
  if (!context.text.trim()) throw new Error("请先选择要处理的代码。")
  if (context.text.length > 24_000) throw new Error("选区过大，请缩小到 24000 字符以内。")
  const instruction = { addToContext: "参考以下代码：", explainCode: "请解释以下代码：", fixCode: "请检查并修复以下代码的问题：", improveCode: "请在保持行为不变的前提下改进以下代码：" }[action]
  return `${instruction}\n${context.path}:${context.startLine}-${context.endLine} (${context.language})\n<selected_code>\n${context.text}\n</selected_code>${action === "fixCode" && context.diagnostics.length ? `\n诊断：\n${context.diagnostics.join("\n")}` : ""}`
}
export function appendContext(draft: string, text: string): string {
  const result = draft ? `${draft}\n\n${text}` : text
  if (result.length > 32_000) throw new Error("加入上下文后超过 32000 字符，请先精简草稿。")
  return result
}
