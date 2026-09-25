import { createPluginCommands } from "@codem/app-server"
import { SpaceDirectory } from "../src/connection/spaceDirectory.ts"
import { realpath } from "node:fs/promises"
import { AppServerHost, assertAppServerAuthenticated, readAppServerAuthStatus, listAppServerSpaces, prepareAppServerSpace, resolveBundledAppServerRuntime } from "@codem/app-server"
import { resolveSessionsRoot } from "@codem/history"
import { createSessionHistoryReader, createSessionHistorySearcher } from "../src/sessionHistory/sessionHistory.ts"
import type { ChatSession } from "../src/chat/chatController.ts"

/** Explicit, opt-in headless Core adapter for reusing an already-created acceptance workspace. */
export async function liveRuntime(extensionRoot: string, workspace: string, signal: AbortSignal): Promise<ChatSession> {
  const cwd = await realpath(workspace)
  const runtime = resolveBundledAppServerRuntime({ extensionRoot })
  const options = { runtime, workingDirectory: cwd, signal }
  const authorize = async () => { signal.throwIfAborted(); assertAppServerAuthenticated(await readAppServerAuthStatus(options)) }
  const status = await readAppServerAuthStatus(options)
  assertAppServerAuthenticated(status)
  const spaces = await listAppServerSpaces(options)
  if (!spaces.current) throw new Error("Choose a CodeM space in the existing VS Code window first")
  const directory = new SpaceDirectory(spaces, status, async refreshSignal => {
    const fresh = await readAppServerAuthStatus({ ...options, signal: refreshSignal })
    assertAppServerAuthenticated(fresh); directory.assertAccount(fresh)
    return listAppServerSpaces({ ...options, signal: refreshSignal })
  })
  let starting = true
  const host = new AppServerHost({ runtime, clientInfo: { name: "codem-vscode-acceptance", version: "0.2.0" }, sessionSource: "vscode", assertAuthenticated: () => starting ? assertAppServerAuthenticated(status) : authorize(), prepareSpace: () => prepareAppServerSpace(options, spaces.current!) })
  try {
    await host.prepareConnection(cwd)
    const catalog = await host.listModels(cwd)
    return { host, cwd, workspace: "acceptance", spaceDirectory: directory, space: { key: spaces.current, name: spaces.spaces.find(space => space.projectKey === spaces.current)!.displayName }, model: catalog.activeModel, models: catalog.models, mcpServers: [], authorize, pluginCommands: createPluginCommands({ runtime, cwd }), searchHistory: createSessionHistorySearcher({ cwd, sessionsRoot: resolveSessionsRoot(process.env), authorize }), readHistory: createSessionHistoryReader({ cwd, sessionsRoot: resolveSessionsRoot(process.env), authorize }) }
  } catch (error) { await host.close(); throw error } finally { starting = false }
}
