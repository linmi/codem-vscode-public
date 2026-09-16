import * as vscode from "vscode"
import {
  AppServerHost,
  listAppServerSpaces,
  prepareAppServerSpace,
  commitAppServerSpace,
  type AppServerSpace,
  type AppServerPreparedSpace,
  type AppServerAuthStatus,
  resolveBundledAppServerRuntime,
  type AppServerHostEvent,
  type AppServerPromptAttachment,
  type AppServerInteractionResponse,
  type AppServerThreadSettings,
  type AppServerThreadSummary,
} from "@codem/app-server"
import type { CodeMAuthenticationService } from "./authentication"

export class CodeMAppServerService implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("CodeM App Server", { log: true })
  private readonly events = new vscode.EventEmitter<AppServerHostEvent>()
  private readonly runtime
  private readonly authentication: CodeMAuthenticationService
  private readonly clientInfo: { readonly name: string; readonly version: string }
  private readonly authenticationChange: vscode.Disposable
  private host: AppServerHost
  private disposed = false
  private switching = false
  private operations = 0
  private space: Promise<AppServerPreparedSpace> | null = null
  private readonly spaceEvents = new vscode.EventEmitter<AppServerSpace | null>()
  private lifetime = new AbortController()
  private readonly backgroundWork = new Set<string>()
  private account: string | null

  readonly onDidChangeSpace = this.spaceEvents.event

  readonly onEvent = this.events.event

  constructor(context: vscode.ExtensionContext, authentication: CodeMAuthenticationService) {
    this.runtime = resolveBundledAppServerRuntime({ extensionRoot: context.extensionPath })
    this.authentication = authentication
    this.account = accountIdentity(authentication.current)
    this.clientInfo = { name: "codem-vscode", version: context.extension.packageJSON.version as string }
    this.host = this.createHost()
    this.authenticationChange = authentication.onDidChange((status) => {
      const account = accountIdentity(status)
      const changed = this.account !== null && this.account !== account
      this.account = account
      if (status.loggedIn && status.routerCredential === true && !changed) return
      this.lifetime.abort()
      this.lifetime = new AbortController()
      this.space = null
      this.backgroundWork.clear()
      this.spaceEvents.fire(null)
      const previous = this.host
      this.host = this.createHost()
      void previous.close()
    })
  }

  private createHost(prepared?: AppServerPreparedSpace): AppServerHost {
    const signal = this.lifetime.signal
    const host = new AppServerHost({
      runtime: this.runtime,
      clientInfo: this.clientInfo,
      assertAuthenticated: async () => {
        requireTrustedWorkspace()
        signal.throwIfAborted()
        await this.authentication.requireAuthenticated()
        signal.throwIfAborted()
      },
      prepareSpace: (cwd) => (prepared ? Promise.resolve(prepared) : this.initialSpace(cwd)),
      onStderr: (_cwd, text) => this.output.append(text),
    })
    host.onEvent((event) => {
      if (host !== this.host) return
      if ((event.type === "item-started" || event.type === "item-completed") && event.item.type === "subagent") {
        const key = `${event.threadId}:${event.item.id}`
        if (event.item.status === "inProgress") this.backgroundWork.add(key)
        else this.backgroundWork.delete(key)
      }
      if (event.type === "thread-closed") {
        for (const key of this.backgroundWork) if (key.startsWith(`${event.threadId}:`)) this.backgroundWork.delete(key)
      }
      this.events.fire(event)
      if (event.type === "authentication-invalidated") {
        void this.authentication.refresh().catch((error: unknown) => {
          this.output.error(`Could not refresh CodeM authentication: ${errorMessage(error)}`)
        })
      }
    })
    return host
  }

  private spaceOptions(cwd: string) {
    return { runtime: this.runtime, workingDirectory: cwd, signal: this.lifetime.signal }
  }

  private initialSpace(cwd: string): Promise<AppServerPreparedSpace> {
    if (this.space) return this.space
    const options = this.spaceOptions(cwd)
    const opening = (async () => {
      const list = await listAppServerSpaces(options)
      if (!list.current) throw new Error("Select a CodeM space before starting a task (CodeM: Select Space).")
      const prepared = await prepareAppServerSpace(options, list.current)
      options.signal.throwIfAborted()
      this.spaceEvents.fire({ projectKey: prepared.projectKey, displayName: prepared.displayName })
      return prepared
    })()
    this.space = opening
    void opening.catch(() => {
      if (this.space === opening) this.space = null
    })
    return opening
  }

  async listSpaces(cwd: string) {
    requireTrustedWorkspace()
    await this.authentication.requireAuthenticated()
    const options = this.spaceOptions(cwd)
    const list = await listAppServerSpaces(options)
    const selected = this.space ? await this.space : null
    options.signal.throwIfAborted()
    return { spaces: list.spaces, current: selected?.projectKey ?? list.current }
  }

  async selectSpace(cwd: string, projectKey: string): Promise<void> {
    requireTrustedWorkspace()
    if (this.disposed || this.switching || this.operations || this.host.hasActiveWork || this.backgroundWork.size)
      throw new Error("Wait for CodeM tasks and requests to finish before switching spaces.")
    this.switching = true
    const options = this.spaceOptions(cwd)
    let candidate: AppServerHost | null = null
    try {
      await this.authentication.requireAuthenticated()
      const prepared = await prepareAppServerSpace(options, projectKey)
      candidate = this.createHost(prepared)
      await candidate.prepareConnection(cwd)
      await candidate.listModels(cwd)
      await candidate.listSkills(cwd)
      options.signal.throwIfAborted()
      if (this.host.hasActiveWork || this.backgroundWork.size)
        throw new Error("CodeM work became active while preparing the space; wait and retry.")
      // The CLI alone persists the active pointer, after all launch checks pass.
      await commitAppServerSpace({ ...options, signal: undefined }, projectKey)
      options.signal.throwIfAborted()
      const previous = this.host
      // Deliver retirement before publishing the new space and catalog.
      try {
        await previous.close()
      } catch {
        this.output.error("The previous CodeM space connection did not close cleanly.")
      }
      options.signal.throwIfAborted()
      this.host = candidate
      candidate = null
      this.space = Promise.resolve(prepared)
      this.backgroundWork.clear()
      this.switching = false
      this.spaceEvents.fire({ projectKey: prepared.projectKey, displayName: prepared.displayName })
    } finally {
      if (candidate) await candidate.close()
      this.switching = false
    }
  }

  private async useHost<T>(operation: (host: AppServerHost) => Promise<T>): Promise<T> {
    if (this.disposed || this.switching)
      throw new Error("CodeM is switching spaces or shutting down; retry when ready.")
    const host = this.host
    this.operations++
    try {
      const result = await operation(host)
      if (this.host !== host || this.disposed) throw new Error("CodeM response belongs to a retired connection")
      return result
    } finally {
      this.operations--
    }
  }

  prepareConnection(cwd: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.prepareConnection(cwd))
  }

  async startThread(cwd: string, requestedModel?: string, intelligence?: string): Promise<string> {
    requireTrustedWorkspace()
    return this.useHost(async (host) => {
      const model = await this.resolveModel(host, cwd, requestedModel)
      return host.startThread(cwd, threadSettings(model, intelligence))
    })
  }

  async resumeThread(cwd: string, threadId: string, requestedModel?: string, intelligence?: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost(async (host) => {
      const model = requestedModel
        ? await this.resolveModel(host, cwd, requestedModel)
        : exactText((await host.readThread(cwd, threadId)).model, "thread model")
      return host.resumeThread(cwd, threadId, threadSettings(model, intelligence))
    })
  }

  listThreads(
    cwd: string,
    cursor?: string,
  ): Promise<{
    readonly threads: readonly AppServerThreadSummary[]
    readonly nextCursor: string | null
    readonly total: number
  }> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.listThreads(cwd, cursor))
  }

  readThread(cwd: string, threadId: string) {
    requireTrustedWorkspace()
    return this.useHost((host) => host.readThread(cwd, threadId))
  }

  listTurns(
    cwd: string,
    threadId: string,
    options?: { readonly cursor?: string; readonly limit?: number; readonly sortDirection?: "asc" | "desc" },
  ) {
    requireTrustedWorkspace()
    return this.useHost((host) => host.listTurns(cwd, threadId, options))
  }

  listItems(
    cwd: string,
    threadId: string,
    options?: {
      readonly turnId?: string
      readonly cursor?: string
      readonly limit?: number
      readonly sortDirection?: "asc" | "desc"
    },
  ) {
    requireTrustedWorkspace()
    return this.useHost((host) => host.listItems(cwd, threadId, options))
  }

  listModels(cwd: string) {
    requireTrustedWorkspace()
    return this.useHost((host) => host.listModels(cwd))
  }

  private async resolveModel(host: AppServerHost, cwd: string, requestedModel?: string): Promise<string> {
    const catalog = await host.listModels(cwd)
    const model = requestedModel ? exactText(requestedModel, "model") : catalog.activeModel
    if (!catalog.models.some((entry) => entry.id === model)) {
      throw new Error(`CodeM model ${model} is not available from Core`)
    }
    return model
  }

  listSkills(cwd: string, threadId?: string) {
    requireTrustedWorkspace()
    return this.useHost((host) => host.listSkills(cwd, threadId))
  }

  startTurn(
    cwd: string,
    threadId: string,
    submissionId: string,
    text: string,
    attachments?: readonly AppServerPromptAttachment[],
  ): Promise<string> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.startTurn({ cwd, threadId, submissionId, text, attachments }))
  }

  steerTurn(cwd: string, threadId: string, submissionId: string, text: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.steerTurn({ cwd, threadId, submissionId, text }))
  }

  compactThread(cwd: string, threadId: string): Promise<string> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.compactThread(cwd, threadId))
  }

  rewindThread(cwd: string, threadId: string): Promise<string> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.rewindThread(cwd, threadId))
  }

  interrupt(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.interruptTurn(cwd, threadId))
  }

  cancelBackgroundTask(cwd: string, threadId: string, taskId: string) {
    requireTrustedWorkspace()
    return this.useHost((host) => host.cancelBackgroundTask(cwd, threadId, taskId))
  }

  startSideQuestion(cwd: string, threadId: string, operationId: string, question: string): Promise<string> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.startSideQuestion(cwd, threadId, operationId, question))
  }

  cancelSideQuestion(cwd: string, threadId: string, sideQuestionId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.cancelSideQuestion(cwd, threadId, sideQuestionId))
  }

  readModes(cwd: string, threadId: string) {
    requireTrustedWorkspace()
    return this.useHost((host) => host.readModes(cwd, threadId))
  }

  setModes(input: {
    readonly cwd: string
    readonly threadId: string
    readonly expectedRevision: number
    readonly permissionMode?: "default" | "auto" | "yolo"
    readonly workMode?: "normal" | "plan"
  }) {
    requireTrustedWorkspace()
    return this.useHost((host) => host.setModes(input))
  }

  renameThread(cwd: string, threadId: string, name: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost((host) =>
      host.control(cwd, "thread/name/set", { threadId, name: exactText(name, "thread name") }).then(() => undefined),
    )
  }

  archiveThread(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.control(cwd, "thread/archive", { threadId }).then(() => undefined))
  }

  unarchiveThread(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.control(cwd, "thread/unarchive", { threadId }).then(() => undefined))
  }

  deleteThread(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.control(cwd, "thread/delete", { threadId }).then(() => undefined))
  }

  async forkThread(cwd: string, threadId: string): Promise<string> {
    requireTrustedWorkspace()
    return this.useHost(async (host) => {
      const result = await host.control(cwd, "thread/fork", { threadId })
      return exactText(result.threadId, "forked threadId")
    })
  }

  unsubscribeThread(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.useHost((host) => host.unsubscribeThread(cwd, threadId))
  }

  respondToInteraction(requestId: string, response: AppServerInteractionResponse): Promise<void> {
    return this.useHost((host) => host.respondToInteraction(requestId, response))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifetime.abort()
    this.spaceEvents.dispose()
    void this.host.close()
    this.authenticationChange.dispose()
    this.events.dispose()
    this.output.dispose()
  }
}

function requireTrustedWorkspace(): void {
  if (!vscode.workspace.isTrusted) {
    throw new Error("Trust this workspace before CodeM starts Core or reads workspace content.")
  }
}

function accountIdentity(status: AppServerAuthStatus | null): string | null {
  return status?.loggedIn ? JSON.stringify([status.serverUrl, status.tenantId, status.userId]) : null
}

function threadSettings(model: string, intelligence?: string): AppServerThreadSettings {
  const configuration = vscode.workspace.getConfiguration("codem")
  return {
    model,
    intelligence: intelligence ?? configuration.get("intelligence", "medium"),
    permissionMode: configuration.get("permissionMode", "auto"),
    workMode: configuration.get("workMode", "default"),
    additionalDirectories: [],
    mcpServers: [],
  }
}

function exactText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`Invalid CodeM ${label}`)
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : String(error)
}
