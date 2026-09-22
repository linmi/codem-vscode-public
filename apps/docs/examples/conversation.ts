import {
  DEFAULT_APP_SERVER_THREAD_SETTINGS,
  type AppServerHost,
  type AppServerHostEvent,
} from "@codem/app-server"

// Host 在整个应用会话期间保持存活。
export async function startConversation(
  host: AppServerHost,
  cwd: string,
  onEvent: (event: AppServerHostEvent) => void,
) {
  const threadId = await host.startThread(
    cwd, DEFAULT_APP_SERVER_THREAD_SETTINGS,
  )
  const unsubscribe = host.onEvent(event => {
    if ("threadId" in event && event.threadId === threadId) {
      onEvent(event)
    } else if (event.type === "interaction" &&
      event.interaction.threadId === threadId) {
      onEvent(event)
    } else if (event.type === "authentication-invalidated" ||
      ((event.type === "protocol-error" ||
        event.type === "connection-closed") && event.cwd === cwd)) {
      onEvent(event)
    }
  })
  try {
    await host.startTurn({
      cwd, threadId,
      submissionId: crypto.randomUUID(),
      text: "解释这个项目的结构",
    })
    // 这里只是提交成功；在 onEvent 中等待 turn-completed。
    return { threadId, unsubscribe }
  } catch (error) {
    unsubscribe()
    throw error
  }
}
// 视图退出时 unsubscribe()；宿主退出时 await host.close()。
