import * as vscode from "vscode"
import { realpath } from "node:fs/promises"
import { AppServerHost, assertAppServerAuthenticated, listAppServerSpaces, prepareAppServerSpace, readAppServerAuthStatus, resolveBundledAppServerRuntime, startAppServerLogin } from "@codem/app-server"
import { resolveSessionsRoot } from "@codem/session-history"
import { createSessionHistoryReader } from "./sessionHistory.ts"
import { UserVisibleError, type ChatSession } from "./chatController.ts"

export function assertTrusted(): void {
  if (!vscode.workspace.isTrusted) throw new UserVisibleError("请先通过 VS Code 管理工作区信任，再连接 CodeM。")
}

export async function connectRuntime(extensionRoot: string, version: string, signIn: boolean, signal: AbortSignal): Promise<ChatSession> {
  assertTrusted()
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) throw new UserVisibleError("请先打开一个项目文件夹。")
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: "选择本次 CodeM 会话的工作区" })
  if (!folder) throw new UserVisibleError("已取消选择工作区。")
  if (folder.uri.scheme !== "file") throw new UserVisibleError("此工作区不提供可用的文件系统，请在本地或远程 Extension Host 中打开项目。")
  assertTrusted()
  signal.throwIfAborted()
  const cwd = await realpath(folder.uri.fsPath)
  const runtime = resolveBundledAppServerRuntime({ extensionRoot })
  const options = { runtime, workingDirectory: cwd }
  let status = await readAppServerAuthStatus(options)
  signal.throwIfAborted()
  if (signIn && !status.loggedIn) {
    status = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "登录 CodeM", cancellable: true }, async (progress, token) => {
      const login = startAppServerLogin({
        ...options,
        presentAuthorization: async (url) => {
          const uri = vscode.Uri.parse(url)
          if (uri.scheme !== "https") throw new UserVisibleError("登录服务返回了不安全的地址。")
          if (!await vscode.env.openExternal(uri)) throw new UserVisibleError("无法打开登录页面，请检查默认浏览器。")
          progress.report({ message: "请在浏览器中完成登录…" })
        },
      })
      const cancel = () => { void login.cancel().catch(() => undefined) }
      signal.addEventListener("abort", cancel, { once: true })
      const subscription = token.onCancellationRequested(cancel)
      if (signal.aborted || token.isCancellationRequested) cancel()
      try { return await login.completed }
      finally { signal.removeEventListener("abort", cancel); subscription.dispose() }
    })
  }
  if (!status.loggedIn) throw new UserVisibleError("尚未登录 CodeM，请点击「登录 CodeM」。")
  assertAppServerAuthenticated(status)
  assertTrusted()
  signal.throwIfAborted()
  const spaces = await listAppServerSpaces({ ...options, signal })
  const key = spaces.current ?? (await vscode.window.showQuickPick(spaces.spaces.map((space) => ({ label: space.displayName, key: space.projectKey })), { title: "选择本次连接使用的 CodeM 空间" }))?.key
  if (!key) throw new UserVisibleError("未选择可用空间，请先在 CodeM 账户中加入空间后重试。")
  signal.throwIfAborted()
  const authorize = async () => {
    assertTrusted()
    assertAppServerAuthenticated(await readAppServerAuthStatus(options))
    assertTrusted()
    signal.throwIfAborted()
  }
  const readHistory = createSessionHistoryReader({ cwd, sessionsRoot: resolveSessionsRoot(process.env), authorize })
  const host = new AppServerHost({
    runtime,
    clientInfo: { name: "codem-vscode", version },
    assertAuthenticated: authorize,
    prepareSpace: () => prepareAppServerSpace({ ...options, signal }, key),
  })
  try {
    await host.prepareConnection(cwd)
    const catalog = await host.listModels(cwd)
    if (!catalog.models.some((model) => model.id === catalog.activeModel)) throw new UserVisibleError("Core 没有返回可用的当前模型。")
    assertTrusted()
    signal.throwIfAborted()
    return { host, cwd, authorize, readHistory, workspace: folder.name, model: catalog.activeModel, models: catalog.models, mcpServers: [] }
  } catch (error) {
    await host.close()
    throw error
  }
}
