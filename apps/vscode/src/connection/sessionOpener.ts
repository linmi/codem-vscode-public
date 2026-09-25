import type { AppServerAuthStatus, BundledAppServerRuntimeResolver } from "@codem/app-server"
import type { ChatSession } from "../chat/chatController.ts"
import type { ConnectionPreferences, ConnectionTarget } from "./connectionPreferences.ts"
import type { SpaceDirectory } from "./spaceDirectory.ts"
import { connectRuntime } from "./runtimeSession.ts"

export interface SessionOpenerOptions {
  /** The activation's one runtime verifier, shared with account reads. */
  runtime: BundledAppServerRuntimeResolver
  version: string
  preferences: Pick<ConnectionPreferences, "lastConnection" | "remember">
  loadMcp: () => Promise<ChatSession["mcpServers"]>
  /** Auth status read while connecting; not reported once the attempt was cancelled. */
  observeAuth: (status: AppServerAuthStatus) => void
  log: (line: string) => void
}

/**
 * Opens the chat's Core sessions: one runtime connection, then the MCP settings, each timed in the output log.
 * A session whose MCP settings fail to load is closed before the failure propagates.
 */
export class SessionOpener {
  private readonly options: SessionOpenerOptions
  constructor(options: SessionOpenerOptions) { this.options = options }

  /** The chat's connection to the last remembered workspace and space. Turn identities, never content, are logged. */
  async connect(signal: AbortSignal): Promise<ChatSession> {
    const session = await this.open(signal, this.options.preferences.lastConnection())
    session.host.onEvent(event => {
      if (event.type === "turn-started") this.options.log(JSON.stringify({ event: event.type, turnId: event.turnId, submissionId: event.submissionId }))
      if (event.type === "turn-completed") this.options.log(JSON.stringify({ event: event.type, turnId: event.turnId, outcome: event.outcome, stopReason: event.stopReason }))
    })
    return session
  }

  /** The same workspace in another space, reusing the space directory the session already read. */
  reopen(session: ChatSession, key: string, signal: AbortSignal): Promise<ChatSession> {
    return this.open(signal, { cwd: session.cwd, workspace: session.workspace, key }, session.spaceDirectory)
  }

  /** Remembers a connected workspace and space for the next connection. */
  remember(session: ChatSession): Promise<void> {
    return this.options.preferences.remember({ cwd: session.cwd, workspace: session.workspace, key: session.space.key })
  }

  private async open(signal: AbortSignal, target: ConnectionTarget | undefined, directory?: SpaceDirectory): Promise<ChatSession> {
    const { runtime, version, loadMcp, observeAuth, log } = this.options
    const runtimeStarted = performance.now()
    const session = await connectRuntime(runtime, version, signal, target, directory, status => { if (!signal.aborted) observeAuth(status) })
    log(`Connection runtime: ${Math.round(performance.now() - runtimeStarted)}ms`)
    try {
      const mcpStarted = performance.now()
      session.mcpServers = await loadMcp()
      log(`Connection MCP settings: ${Math.round(performance.now() - mcpStarted)}ms`)
      return session
    } catch (error) { await session.host.close(); throw error }
  }
}
