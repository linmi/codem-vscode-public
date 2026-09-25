/**
 * Webview 发给 Host 的请求 ID。
 * Host 按 ID 对应回执，所以同一毫秒内连发的请求也不能同号；页面重载后也不能和上一页留下的待确认请求撞号。
 * 页面标识用 crypto.getRandomValues，不用 crypto.randomUUID：JetBrains 的 JCEF 页面从 file:// 加载，
 * 不是安全上下文，没有 randomUUID。结果只含小写字母、数字和连字符，满足两端 Host 的 requestId 校验。
 */
const page = Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) => part.toString(36)).join("")
let sequence = 0

export function nextRequestId(prefix: "req" | "mention" | "pick"): string {
  sequence += 1
  return `${prefix}-${page}-${sequence.toString(36)}`
}
