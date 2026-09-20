export const MAX_PINNED_CODE_SELECTIONS = 20
export type EditorAction = "addToContext" | "explainCode" | "fixCode" | "improveCode"
export interface CodeContext { path: string; language: string; startLine: number; endLine: number; text: string; diagnostics: readonly string[] }
const codeInstructions = { addToContext: "参考以下代码：", explainCode: "请解释以下代码：", fixCode: "请检查并修复以下代码的问题：", improveCode: "请在保持行为不变的前提下改进以下代码：" } as const
export function codePrompt(action: EditorAction, context: CodeContext): string {
  if (!context.text.trim()) throw new Error("请先选择要处理的代码。")
  if (context.text.length > 24_000) throw new Error("选区过大，请缩小到 24000 字符以内。")
  const instruction = codeInstructions[action]
  return `${instruction}\n${context.path}:${context.startLine}-${context.endLine} (${context.language})\n<selected_code>\n${context.text}\n</selected_code>${action === "fixCode" && context.diagnostics.length ? `\n诊断：\n${context.diagnostics.join("\n")}` : ""}`
}

export type CodePromptPart = { kind: "text"; text: string } | { kind: "code"; path: string; language: string; startLine: number; endLine: number; text: string }
/** Decode only CodeM's persisted codePrompt envelope; all unmatched user text stays literal. */
export function codePromptParts(text: string): CodePromptPart[] {
  const pattern = new RegExp(`(?:^|\\n\\n)(${Object.values(codeInstructions).join("|")})\\n([^\\r\\n]+):([1-9]\\d*)-([1-9]\\d*) \\(([^\\r\\n()]+)\\)\\n<selected_code>\\n([\\s\\S]*?)\\n</selected_code>(?=$|\\n\\n|\\n诊断：)`, "g")
  const parts: CodePromptPart[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const startLine = Number(match[3]), endLine = Number(match[4])
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || endLine < startLine) continue
    if (match.index > cursor) parts.push({ kind: "text", text: text.slice(cursor, match.index) })
    if (match[1] !== codeInstructions.addToContext) parts.push({ kind: "text", text: match[1]! })
    parts.push({ kind: "code", path: match[2]!, language: match[5]!, startLine, endLine, text: match[6]! })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) })
  return parts
}
export function appendContext(draft: string, text: string): string {
  const result = draft ? `${draft}\n\n${text}` : text
  if (result.length > 32_000) throw new Error("加入上下文后超过 32000 字符，请先精简草稿。")
  return result
}
