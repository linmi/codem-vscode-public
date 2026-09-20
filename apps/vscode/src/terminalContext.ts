import { stripVTControlCharacters } from "node:util"
export class TerminalOutput {
  private text = ""
  private truncated = false
  private readonly limit: number
  constructor(limit = 20_000) { this.limit = limit }
  append(chunk: string): void {
    this.text += chunk
    if (this.text.length > this.limit) { this.text = this.text.slice(-this.limit); this.truncated = true }
  }
  snapshot(): string { return `${this.truncated ? "（仅保留最近输出）\n" : ""}${stripVTControlCharacters(this.text)}` }
}
export function terminalPrompt(action: "context" | "explain" | "fix", text: string): string {
  if (!text.trim()) throw new Error("没有可读取的终端内容，请选择文本或重新运行命令。")
  if (text.length > 24_000) throw new Error("终端内容过长，请缩小选区。")
  const instruction = { context: "参考以下终端内容：", explain: "请解释以下终端命令和输出：", fix: "请分析以下终端错误并给出修复建议，执行命令前先说明原因：" }[action]
  return `${instruction}\n<terminal_output>\n${text}\n</terminal_output>`
}
