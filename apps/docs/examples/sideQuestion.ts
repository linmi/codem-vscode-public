import type { AppServerHost } from "@codem/app-server"

// 主轮次和旁问均空闲时；先注册 Host 事件监听。
export async function askAside(
  host: AppServerHost, cwd: string, threadId: string, question: string,
) {
  return host.startSideQuestion(cwd, threadId, crypto.randomUUID(), question)
}
export async function cancelAside(
  host: AppServerHost, cwd: string, threadId: string, sideQuestionId: string,
) {
  await host.cancelSideQuestion(cwd, threadId, sideQuestionId)
  // 等待 side-question-completed，再恢复旁问输入。
}
export async function stopMainTurn(host: AppServerHost, cwd: string, threadId: string) {
  await host.interruptTurn(cwd, threadId)
  // 等待 turn-completed，再允许下一次发送。
}
