export type CodePromptPart = { kind: "text"; text: string } | { kind: "code"; path: string; language: string; startLine: number; endLine: number; text: string }

const codeInstructions = ["参考以下代码：", "请解释以下代码：", "请检查并修复以下代码的问题：", "请在保持行为不变的前提下改进以下代码："] as const

/** 只解析 CodeM 持久化的代码引用信封，其余用户文本保持原样。 */
export function codePromptParts(text: string): CodePromptPart[] {
  const pattern = new RegExp(`(?:^|\\n\\n)(${codeInstructions.join("|")})\\n([^\\r\\n]+):([1-9]\\d*)-([1-9]\\d*) \\(([^\\r\\n()]+)\\)\\n<selected_code>\\n([\\s\\S]*?)\\n</selected_code>(?=$|\\n\\n|\\n诊断：)`, "g")
  const parts: CodePromptPart[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const startLine = Number(match[3])
    const endLine = Number(match[4])
    if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || endLine < startLine) continue
    if (match.index > cursor) parts.push({ kind: "text", text: text.slice(cursor, match.index) })
    if (match[1] !== codeInstructions[0]) parts.push({ kind: "text", text: match[1]! })
    parts.push({ kind: "code", path: match[2]!, language: match[5]!, startLine, endLine, text: match[6]! })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) })
  return parts
}
