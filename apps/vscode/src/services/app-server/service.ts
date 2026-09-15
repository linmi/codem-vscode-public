import * as vscode from "vscode"
import {
  AppServerHost,
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

  readonly onEvent = this.events.event

  constructor(context: vscode.ExtensionContext, authentication: CodeMAuthenticationService) {
    this.runtime = resolveBundledAppServerRuntime({ extensionRoot: context.extensionPath })
    this.authentication = authentication
    this.clientInfo = { name: "codem-vscode", version: context.extension.packageJSON.version as string }
    this.host = this.createHost()
    this.authenticationChange = authentication.onDidChange((status) => {
      if (status.loggedIn && status.routerCredential === true) return
      const previous = this.host
      this.host = this.createHost()
      void previous.close()
    })
  }

  private createHost(): AppServerHost {
    const host = new AppServerHost({
      runtime: this.runtime,
      clientInfo: this.clientInfo,
      assertAuthenticated: async () => {
        requireTrustedWorkspace()
        await this.authentication.requireAuthenticated()
      },
      onStderr: (_cwd, text) => this.output.append(text),
    })
    host.onEvent((event) => {
      this.events.fire(event)
      if (event.type === "authentication-invalidated") {
        void this.authentication.refresh().catch((error: unknown) => {
          this.output.error(`Could not refresh CodeM authentication: ${errorMessage(error)}`)
        })
      }
    })
    return host
  }

  prepareConnection(cwd: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host.prepareConnection(cwd)
  }

  async startThread(cwd: string, requestedModel?: string, intelligence?: string): Promise<string> {
    requireTrustedWorkspace()
    const model = await this.resolveModel(cwd, requestedModel)
    return this.host.startThread(cwd, threadSettings(model, intelligence))
  }

  async resumeThread(cwd: string, threadId: string, requestedModel?: string, intelligence?: string): Promise<void> {
    requireTrustedWorkspace()
    const model = requestedModel
      ? await this.resolveModel(cwd, requestedModel)
      : exactText((await this.host.readThread(cwd, threadId)).model, "thread model")
    return this.host.resumeThread(cwd, threadId, threadSettings(model, intelligence))
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
    return this.host.listThreads(cwd, cursor)
  }

  readThread(cwd: string, threadId: string) {
    requireTrustedWorkspace()
    return this.host.readThread(cwd, threadId)
  }

  listTurns(
    cwd: string,
    threadId: string,
    options?: { readonly cursor?: string; readonly limit?: number; readonly sortDirection?: "asc" | "desc" },
  ) {
    requireTrustedWorkspace()
    return this.host.listTurns(cwd, threadId, options)
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
    return this.host.listItems(cwd, threadId, options)
  }

  listModels(cwd: string) {
    requireTrustedWorkspace()
    return this.host.listModels(cwd)
  }

  private async resolveModel(cwd: string, requestedModel?: string): Promise<string> {
    const catalog = await this.host.listModels(cwd)
    const model = requestedModel ? exactText(requestedModel, "model") : catalog.activeModel
    if (!catalog.models.some((entry) => entry.id === model)) {
      throw new Error(`CodeM model ${model} is not available from Core`)
    }
    return model
  }

  listSkills(cwd: string, threadId?: string) {
    requireTrustedWorkspace()
    return this.host.listSkills(cwd, threadId)
  }

  startTurn(
    cwd: string,
    threadId: string,
    submissionId: string,
    text: string,
    attachments?: readonly AppServerPromptAttachment[],
  ): Promise<string> {
    requireTrustedWorkspace()
    return this.host.startTurn({ cwd, threadId, submissionId, text, attachments })
  }

  steerTurn(cwd: string, threadId: string, submissionId: string, text: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host.steerTurn({ cwd, threadId, submissionId, text })
  }

  compactThread(cwd: string, threadId: string): Promise<string> {
    requireTrustedWorkspace()
    return this.host.compactThread(cwd, threadId)
  }

  rewindThread(cwd: string, threadId: string): Promise<string> {
    requireTrustedWorkspace()
    return this.host.rewindThread(cwd, threadId)
  }

  interrupt(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host.interruptTurn(cwd, threadId)
  }

  cancelBackgroundTask(cwd: string, threadId: string, taskId: string) {
    requireTrustedWorkspace()
    return this.host.cancelBackgroundTask(cwd, threadId, taskId)
  }

  startSideQuestion(cwd: string, threadId: string, operationId: string, question: string): Promise<string> {
    requireTrustedWorkspace()
    return this.host.startSideQuestion(cwd, threadId, operationId, question)
  }

  cancelSideQuestion(cwd: string, threadId: string, sideQuestionId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host.cancelSideQuestion(cwd, threadId, sideQuestionId)
  }

  readModes(cwd: string, threadId: string) {
    requireTrustedWorkspace()
    return this.host.readModes(cwd, threadId)
  }

  setModes(input: {
    readonly cwd: string
    readonly threadId: string
    readonly expectedRevision: number
    readonly permissionMode?: "default" | "auto" | "yolo"
    readonly workMode?: "normal" | "plan"
  }) {
    requireTrustedWorkspace()
    return this.host.setModes(input)
  }

  renameThread(cwd: string, threadId: string, name: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host
      .control(cwd, "thread/name/set", { threadId, name: exactText(name, "thread name") })
      .then(() => undefined)
  }

  archiveThread(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host.control(cwd, "thread/archive", { threadId }).then(() => undefined)
  }

  unarchiveThread(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host.control(cwd, "thread/unarchive", { threadId }).then(() => undefined)
  }

  deleteThread(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host.control(cwd, "thread/delete", { threadId }).then(() => undefined)
  }

  async forkThread(cwd: string, threadId: string): Promise<string> {
    requireTrustedWorkspace()
    const result = await this.host.control(cwd, "thread/fork", { threadId })
    return exactText(result.threadId, "forked threadId")
  }

  unsubscribeThread(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host.unsubscribeThread(cwd, threadId)
  }

  respondToInteraction(requestId: string, response: AppServerInteractionResponse): Promise<void> {
    return this.host.respondToInteraction(requestId, response)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
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
