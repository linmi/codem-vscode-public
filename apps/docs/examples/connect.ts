import {
  AppServerHost,
  assertAppServerAuthenticated,
  readAppServerAuthStatus,
  resolveAppServerRuntime,
} from "@codem/app-server"

// packageRoot：能够解析已安装 Core / CLI 的包绝对路径。
export function createHost(packageRoot: string) {
  const runtime = resolveAppServerRuntime({ packageRoot })
  return new AppServerHost({
    runtime,
    clientInfo: { name: "my-codem-client", version: "0.1.0" },
    // Core 写入会话记录的来源标识（session_source），由应用自己命名。
    sessionSource: "my-editor",
    assertAuthenticated: async workingDirectory => {
      const status = await readAppServerAuthStatus({
        runtime, workingDirectory,
      })
      assertAppServerAuthenticated(status)
    },
  })
}
// 应用退出或会话宿主销毁时：await host.close()
// 未配置 prepareSpace 时，不启用 managed layer。
