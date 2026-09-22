import type { AppServerHost } from "@codem/app-server"

export async function readTerminals(host: AppServerHost, cwd: string, threadId: string) {
  return host.listBackgroundTerminals(cwd, threadId)
}
// taskId 来自当前线程的后台任务；由用户明确发起取消。
export async function cancelTask(
  host: AppServerHost, cwd: string, threadId: string, taskId: string,
) {
  const status = await host.cancelBackgroundTask(cwd, threadId, taskId)
  switch (status) {
    case "cancelled": return "取消请求已确认"
    case "notFound": return "任务已不存在，请刷新"
    case "noop": return "本次未执行取消，请核对任务状态"
  }
}
