import { SpaceDirectory } from "./spaceDirectory.ts"
import * as vscode from "vscode"
import { realpath } from "node:fs/promises"
import { AppServerHost, assertAppServerAuthenticated, listAppServerSpaces, prepareAppServerSpace, prepareInitialAppServerSpace, readAppServerAuthStatus, resolveBundledAppServerRuntime, type AppServerAuthStatus } from "@codem/app-server"
import { resolveSessionsRoot } from "@codem/history"
import { createSessionHistoryReader, createSessionHistorySearcher } from "../sessionHistory/sessionHistory.ts"
import { type ChatSession } from "../chat/chatController.ts"
import { UserVisibleError } from "../shared/userVisibleError.ts"

export function assertTrusted(): void {
  if (!vscode.workspace.isTrusted) throw new UserVisibleError("请先通过 VS Code 管理工作区信任，再连接 CodeM。")
}

export async function connectRuntime(extensionRoot: string, version: string, signal: AbortSignal, target?: { cwd: string; workspace: string; key: string }, knownSpaces?: SpaceDirectory, onAuth?: (status: AppServerAuthStatus) => void): Promise<ChatSession> {
  assertTrusted()
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length === 0) throw new UserVisibleError("请先打开一个项目文件夹。")
  const canonicalFolders = target ? await Promise.all(folders.map(async folder => ({ folder, cwd: folder.uri.scheme === "file" ? await realpath(folder.uri.fsPath) : null }))) : []
  const remembered = canonicalFolders.find(entry => entry.cwd === target?.cwd)?.folder
  const folder = remembered ?? (folders.length === 1 && !target ? folders[0] : (await pickForConnection(folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })), target ? "上次工作区已不可用，请重新选择" : "选择本次 CodeM 会话的工作区", signal))?.folder)
  if (!folder) throw new UserVisibleError("已取消选择工作区。")
  if (folder.uri.scheme !== "file") throw new UserVisibleError("此工作区不提供可用的文件系统，请在本地或远程 Extension Host 中打开项目。")
  assertTrusted()
  signal.throwIfAborted()
  const cwd = await realpath(folder.uri.fsPath)
  const runtime = resolveBundledAppServerRuntime({ extensionRoot })
  const options = { runtime, workingDirectory: cwd, signal }
  const readStatus = async (signal: AbortSignal) => {
    const status = await readAppServerAuthStatus({ ...options, signal })
    onAuth?.(status)
    return status
  }
  let status = await readStatus(signal)
  signal.throwIfAborted()
  if (!status.loggedIn) throw new UserVisibleError("尚未登录 CodeM，请点击「登录 CodeM」。")
  assertAppServerAuthenticated(status)
  assertTrusted()
  signal.throwIfAborted()
  const reusableSpaces = knownSpaces?.matchesAccount(status) ? knownSpaces : undefined
  const initial = reusableSpaces ? null : await prepareInitialAppServerSpace(options, target?.key)
  const spaces = initial ? initial.catalog : { current: target?.key ?? null, spaces: reusableSpaces!.list() }
  let prepared = initial?.kind === "prepared" ? initial.space : null
  const requestedKey = target?.key ?? spaces.current
  const needsSelection = !spaces.spaces.some(space => space.projectKey === requestedKey)
  const key = !needsSelection ? requestedKey : (await pickForConnection(spaces.spaces.map((space) => ({ label: space.displayName, key: space.projectKey })), requestedKey ? "上次空间已不可用，请重新选择 CodeM 空间" : "选择本次连接使用的 CodeM 空间", signal))?.key
  if (!key) throw new UserVisibleError("未选择可用空间，请先在 CodeM 账户中加入空间后重试。")
  const space = spaces.spaces.find(space => space.projectKey === key)
  if (!space) throw new UserVisibleError("所选空间已不可用，请重新选择。")
  signal.throwIfAborted()
  // A user prompt may have remained open for an arbitrary time; renew auth then.
  if (needsSelection) { status = await readStatus(signal); assertAppServerAuthenticated(status) }
  let directory: SpaceDirectory
  const authorize = async () => {
    assertTrusted()
    const current = await readStatus(signal)
    assertAppServerAuthenticated(current)
    directory.assertAccount(current)
    assertTrusted()
    signal.throwIfAborted()
  }
  directory = reusableSpaces ?? new SpaceDirectory(spaces, status, async refreshSignal => {
    assertTrusted()
    const current = await readStatus(refreshSignal)
    assertAppServerAuthenticated(current); directory.assertAccount(current)
    return listAppServerSpaces({ ...options, signal: refreshSignal })
  })
  // Reuse only the authentication already verified within this startup transaction.
  // Later reconnects and operations always call authorize again.
  let starting = true
  const searchHistory = createSessionHistorySearcher({ cwd, sessionsRoot: resolveSessionsRoot(process.env), authorize })
  const readHistory = createSessionHistoryReader({ cwd, sessionsRoot: resolveSessionsRoot(process.env), authorize })
  const host = new AppServerHost({
    runtime,
    clientInfo: { name: "codem-vscode", version },
    assertAuthenticated: async () => { assertTrusted(); signal.throwIfAborted(); if (starting) assertAppServerAuthenticated(status); else await authorize() },
    prepareSpace: () => {
      // Consume launch material once, within the startup transaction that verified it.
      if (prepared) { const space = prepared; prepared = null; return Promise.resolve(space) }
      return prepareAppServerSpace({ ...options, signal }, key)
    },
  })
  try {
    await host.prepareConnection(cwd)
    const catalog = await host.listModels(cwd)
    if (!catalog.models.some((model) => model.id === catalog.activeModel)) throw new UserVisibleError("Core 没有返回可用的当前模型。")
    assertTrusted()
    signal.throwIfAborted()
    return { host, cwd, authorize, readHistory, searchHistory, workspace: folder.name, space: { key, name: space.displayName }, spaceDirectory: directory, model: catalog.activeModel, models: catalog.models, mcpServers: [] }
  } catch (error) {
    await host.close()
    throw error
  } finally { starting = false }
}

async function pickForConnection<T extends vscode.QuickPickItem>(items: T[], title: string, signal: AbortSignal): Promise<T | undefined> {
  signal.throwIfAborted()
  const cancellation = new vscode.CancellationTokenSource()
  const cancel = () => cancellation.cancel()
  signal.addEventListener("abort", cancel, { once: true })
  try { return await vscode.window.showQuickPick(items, { title }, cancellation.token) }
  finally { signal.removeEventListener("abort", cancel); cancellation.dispose() }
}
