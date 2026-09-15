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
    host.onEvent((event) => this.events.fire(event))
    return host
  }

  startThread(cwd: string): Promise<string> {
    requireTrustedWorkspace()
    return this.host.startThread(cwd, threadSettings())
  }

  resumeThread(cwd: string, threadId: string): Promise<void> {
    requireTrustedWorkspace()
    return this.host.resumeThread(cwd, threadId, threadSettings())
  }

  listThreads(cwd: string): Promise<{
    readonly threads: readonly AppServerThreadSummary[]
    readonly nextCursor: string | null
    readonly total: number
  }> {
    requireTrustedWorkspace()
    return this.host.listThreads(cwd)
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

  interrupt(cwd: string, threadId: string): Promise<void> {
    return this.host.interruptTurn(cwd, threadId)
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

function threadSettings(): AppServerThreadSettings {
  const configuration = vscode.workspace.getConfiguration("codem")
  return {
    model: configuration.get("model", "codem/auto"),
    intelligence: configuration.get("intelligence", "medium"),
    permissionMode: configuration.get("permissionMode", "auto"),
    workMode: configuration.get("workMode", "default"),
    additionalDirectories: [],
    mcpServers: [],
  }
}
