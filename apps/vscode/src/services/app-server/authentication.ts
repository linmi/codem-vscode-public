import { mkdirSync } from "node:fs"
import * as vscode from "vscode"
import {
  AppServerLoginCancelledError,
  assertAppServerAuthenticated,
  readAppServerAuthStatus,
  resolveBundledAppServerRuntime,
  signOutAppServer,
  startAppServerLogin,
  type AppServerAuthStatus,
  type AppServerLoginOperation,
} from "@codem/app-server"

export class CodeMAuthenticationService implements vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<AppServerAuthStatus>()
  private readonly runtime
  private readonly workingDirectory: string
  private status: AppServerAuthStatus | null = null
  private refreshInFlight: Promise<AppServerAuthStatus> | null = null
  private login: AppServerLoginOperation | null = null

  readonly onDidChange = this.changes.event

  constructor(context: vscode.ExtensionContext) {
    this.runtime = resolveBundledAppServerRuntime({ extensionRoot: context.extensionPath })
    this.workingDirectory = context.globalStorageUri.fsPath
    mkdirSync(this.workingDirectory, { recursive: true })
  }

  get current(): AppServerAuthStatus | null {
    return this.status
  }

  initialize(): Promise<AppServerAuthStatus> {
    return this.refresh()
  }

  refresh(): Promise<AppServerAuthStatus> {
    if (this.refreshInFlight) return this.refreshInFlight
    const refresh = readAppServerAuthStatus({
      runtime: this.runtime,
      workingDirectory: this.workingDirectory,
    })
      .then((status) => this.publish(status))
      .finally(() => {
        if (this.refreshInFlight === refresh) this.refreshInFlight = null
      })
    this.refreshInFlight = refresh
    return refresh
  }

  async requireAuthenticated(): Promise<AppServerAuthStatus> {
    const status = this.status ?? (await this.refresh())
    assertAppServerAuthenticated(status)
    return status
  }

  async signIn(): Promise<AppServerAuthStatus> {
    if (this.login) return this.login.completed
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "登录或注册 CodeM",
        cancellable: true,
      },
      async (progress, cancellation) => {
        const login = startAppServerLogin({
          runtime: this.runtime,
          workingDirectory: this.workingDirectory,
          presentAuthorization: async (authorizationUrl) => {
            const opened = await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl, true))
            if (!opened) throw new Error("无法打开 CodeM 登录/注册页面")
          },
          onProgress: (stage) => {
            if (stage === "authorization-ready") progress.report({ message: "请在浏览器中登录或注册" })
            if (stage === "binding") progress.report({ message: "正在绑定此设备" })
            if (stage === "authenticated") progress.report({ message: "正在确认登录状态" })
          },
        })
        this.login = login
        const cancel = cancellation.onCancellationRequested(() => void login.cancel())
        try {
          const status = this.publish(await login.completed)
          void vscode.window.showInformationMessage("CodeM 登录成功")
          return status
        } catch (error: unknown) {
          if (error instanceof AppServerLoginCancelledError) {
            void vscode.window.showInformationMessage("已取消 CodeM 登录")
          } else {
            void vscode.window.showErrorMessage(userFacingError("CodeM 登录失败", error))
          }
          throw error
        } finally {
          cancel.dispose()
          if (this.login === login) this.login = null
        }
      },
    )
  }

  async signOut(): Promise<AppServerAuthStatus> {
    await this.login?.cancel()
    const status = this.publish(
      await signOutAppServer({
        runtime: this.runtime,
        workingDirectory: this.workingDirectory,
      }),
    )
    void vscode.window.showInformationMessage("已退出 CodeM")
    return status
  }

  async cancelSignIn(): Promise<void> {
    await this.login?.cancel()
  }

  dispose(): void {
    void this.login?.cancel()
    this.changes.dispose()
  }

  private publish(status: AppServerAuthStatus): AppServerAuthStatus {
    this.status = status
    void vscode.commands.executeCommand("setContext", "codem.authenticated", isRoutable(status))
    this.changes.fire(status)
    return status
  }
}

function isRoutable(status: AppServerAuthStatus): boolean {
  return status.loggedIn && status.routerCredential === true
}

function userFacingError(prefix: string, error: unknown): string {
  if (!(error instanceof Error) || !error.message.trim()) return prefix
  return `${prefix}：${error.message}`
}
