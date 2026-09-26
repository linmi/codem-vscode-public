export function generatedText(raw: string, key: "message" | "command"): string {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error("模型未返回预期格式，请重试。") }
  const text = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
  if (typeof text !== "string" || !text.trim() || text.length > 4000 || [...text].some(c => c.charCodeAt(0) < 32 && c !== "\n" && c !== "\r" && c !== "\t")) throw new Error("模型返回了空内容、过长内容或控制字符。")
  return text.trim()
}
