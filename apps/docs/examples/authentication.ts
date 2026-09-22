import {
  readAppServerAuthStatus, startAppServerLogin,
  assertAppServerAuthenticated, type AppServerRuntime,
} from "@codem/app-server"

export async function checkLogin(runtime: AppServerRuntime, cwd: string) {
  return readAppServerAuthStatus({ runtime, workingDirectory: cwd })
}

// 在用户点击登录后调用；presentAuthorization 由平台打开系统浏览器。
export function beginLogin(
  runtime: AppServerRuntime, cwd: string,
  presentAuthorization: (url: string) => Promise<void>,
) {
  const login = startAppServerLogin({
    runtime, workingDirectory: cwd, presentAuthorization,
  })
  return {
    cancel: login.cancel,
    completed: login.completed.then(status => {
      assertAppServerAuthenticated(status)
      return status
    }),
  }
}
// completed 拒绝时显示失败；取消会产生 AppServerLoginCancelledError。
// 应用必须观察 completed；取消按钮调用并等待 cancel()。
