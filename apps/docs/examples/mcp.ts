import {
  DEFAULT_APP_SERVER_THREAD_SETTINGS,
  type AppServerHost, type AppServerMcpServer,
} from "@codem/app-server"

// server 是平台已审核的 stdio 配置；密钥不从 Webview 明文读取。
export async function startWithTools(
  host: AppServerHost, cwd: string, server: AppServerMcpServer,
) {
  const threadId = await host.startThread(cwd, {
    ...DEFAULT_APP_SERVER_THREAD_SETTINGS,
    mcpServers: [server],
  })
  const tools = await host.listTools(cwd, threadId)
  return { threadId, tools }
}
// 配置字段：type:"stdio", name, command, args, env:[{name,value}]。
// 工具目录结果不表示 MCP 进程已经通过健康检查。
