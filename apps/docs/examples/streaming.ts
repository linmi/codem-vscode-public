import type { AppServerHostEvent } from "@codem/app-server"

// 在应用 Host 内消费已校验事件，再转换为界面快照。
export function logTurn(event: AppServerHostEvent) {
  switch (event.type) {
    case "text-delta":
      process.stdout.write(event.delta) // 保留空格和换行
      break
    case "turn-completed":
      console.log(event.outcome, event.error)
      break
    case "protocol-error":
    case "authentication-invalidated":
      console.error(event.message)
      break
    case "connection-closed":
      console.error("Core 连接已关闭", event.cwd)
      break
  }
}
// interaction 交给独立的审批 UI，不能自动同意或丢弃。
