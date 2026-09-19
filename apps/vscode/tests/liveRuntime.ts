import { realpath } from "node:fs/promises"
import { AppServerHost, assertAppServerAuthenticated, readAppServerAuthStatus, listAppServerSpaces, prepareAppServerSpace, resolveBundledAppServerRuntime } from "@codem/app-server"
import { resolveSessionsRoot } from "@codem/session-history"
import { createSessionHistoryReader } from "../src/sessionHistory.ts"
import type { ChatSession } from "../src/chatController.ts"

/** Explicit, opt-in headless Core adapter for reusing an already-created acceptance workspace. */
export async function liveRuntime(extensionRoot: string, workspace: string, signal: AbortSignal): Promise<ChatSession> {
  const cwd = await realpath(workspace)
  const runtime = resolveBundledAppServerRuntime({ extensionRoot })
  const options = { runtime, workingDirectory: cwd, signal }
  const authorize = async () => { signal.throwIfAborted(); assertAppServerAuthenticated(await readAppServerAuthStatus(options)) }
  await authorize()
  const spaces = await listAppServerSpaces(options)
  if (!spaces.current) throw new Error("Choose a CodeM space in the existing VS Code window first")
  const host = new AppServerHost({ runtime, clientInfo: { name: "codem-vscode-acceptance", version: "0.2.0" }, assertAuthenticated: authorize, prepareSpace: () => prepareAppServerSpace(options, spaces.current!) })
  try {
    await host.prepareConnection(cwd)
    const catalog = await host.listModels(cwd)
    return { host, cwd, workspace: "acceptance", model: catalog.activeModel, models: catalog.models, mcpServers: [], authorize, readHistory: createSessionHistoryReader({ cwd, sessionsRoot: resolveSessionsRoot(process.env), authorize }) }
  } catch (error) { await host.close(); throw error }
}
