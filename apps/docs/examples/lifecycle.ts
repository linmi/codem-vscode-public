import type { AppServerHost } from "@codem/app-server"

// 调用前：同步撤销旧事件归属、禁用提交并清空过期审批控件。
export async function disposeHost(
  host: AppServerHost,
  unsubscribe: () => void,
) {
  unsubscribe()
  await host.close()
}
// close 可重复调用，必须观察拒绝结果；不要吞掉回收失败。
// 关闭是应用退出动作，不能紧接在 startTurn 回执后执行。
