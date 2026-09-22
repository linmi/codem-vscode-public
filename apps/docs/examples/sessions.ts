import {
  DEFAULT_APP_SERVER_THREAD_SETTINGS,
  type AppServerHost,
} from "@codem/app-server"

export async function resumeConversation(
  host: AppServerHost, cwd: string, threadId: string,
) {
  const detail = await host.readThread(cwd, threadId)
  if (detail.cwd !== cwd) throw new Error("会话不属于当前工作区")
  await host.resumeThread(cwd, threadId, DEFAULT_APP_SERVER_THREAD_SETTINGS)
  return host.readModes(cwd, threadId)
}
// threadId 应来自当前工作区 listThreads 的结果。
// 历史正文由 @codem/history 单独读取。
