import type { AppServerHost } from "@codem/app-server"

export async function readSessionPage(
  host: AppServerHost, cwd: string, cursor?: string,
) {
  return host.listThreads(cwd, cursor)
}
export async function readLivePage(
  host: AppServerHost, cwd: string, threadId: string, cursor?: number,
) {
  return host.listLiveThreadTurns(cwd, threadId, cursor)
}
export async function readItemPage(
  host: AppServerHost, cwd: string, threadId: string, cursor?: number,
) {
  return host.listLiveThreadItems(cwd, threadId, cursor)
}
export async function readLoaded(host: AppServerHost, cwd: string) {
  return host.listLoadedThreadIds(cwd)
}
// 将各自的 nextCursor 原样传回；null 时隐藏“加载更多”。
// 不混合两种游标；实时快照不能恢复持久历史正文。
