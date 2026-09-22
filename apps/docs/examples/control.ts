import type { AppServerHost } from "@codem/app-server"

export async function steerActiveTurn(
  host: AppServerHost, cwd: string, threadId: string,
  text: string,
) {
  await host.steerTurn({
    cwd, threadId, submissionId: crypto.randomUUID(), text,
  })
}
// 仅在已有活跃轮次时调用；Host 关联 expectedTurnId。
// 停止：await host.interruptTurn(cwd, threadId)
// 停止回执仍须等待 turn-completed 事件。
