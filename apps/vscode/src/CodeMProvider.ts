import * as vscode from "vscode"
import type { AppServerHostEvent, AppServerInteractionResponse, AppServerThreadSummary } from "@codem/app-server"
import type { CodeMAuthenticationService } from "./services/app-server/authentication"
import type { CodeMAppServerService } from "./services/app-server/service"
import type {
  CodeMChatMessage,
  CodeMHostToWebviewMessage,
  CodeMWebviewState,
  CodeMWebviewToHostMessage,
} from "./shared/codem-webview"

export class CodeMProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "codem.SidebarProvider"

  private view: vscode.WebviewView | null = null
  private threadId: string | null = null
  private turnId: string | null = null
  private threads: readonly AppServerThreadSummary[] = []
  private messages: CodeMChatMessage[] = []
  private running = false
  private error: string | null = null
  private interaction: CodeMWebviewState["interaction"] = null
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly appServer: CodeMAppServerService,
    private readonly authentication: CodeMAuthenticationService,
  ) {
    this.disposables.push(
      appServer.onEvent((event) => this.acceptEvent(event)),
      authentication.onDidChange(() => void this.publishState()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.refresh()),
    )
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] }
    view.webview.html = this.html(view.webview)
    this.disposables.push(view.webview.onDidReceiveMessage((message: unknown) => void this.handleMessage(message)))
    void this.refresh()
  }

  async newThread(): Promise<void> {
    const cwd = workspaceDirectory()
    this.error = null
    this.threadId = await this.appServer.startThread(cwd)
    this.turnId = null
    this.messages = []
    this.running = false
    this.interaction = null
    await this.refreshThreads(cwd)
    await this.publishState()
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose()
  }

  private async handleMessage(value: unknown): Promise<void> {
    try {
      const message = parseMessage(value)
      if (message.type === "ready") return await this.refresh()
      if (message.type === "new-thread") return await this.newThread()
      if (message.type === "open-thread") return await this.openThread(message.threadId)
      if (message.type === "send") return await this.send(message.submissionId, message.text)
      if (message.type === "interrupt") {
        if (this.threadId) await this.appServer.interrupt(workspaceDirectory(), this.threadId)
        return
      }
      if (message.type === "sign-in") {
        await this.authentication.signIn()
        return await this.refresh()
      }
      if (message.type === "sign-out") {
        await this.authentication.signOut()
        this.threadId = null
        this.threads = []
        this.messages = []
        return await this.publishState()
      }
      if (message.type === "open-settings") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:codem.codem")
        return
      }
      if (message.type === "interaction-response") {
        await this.appServer.respondToInteraction(message.requestId, message.response as AppServerInteractionResponse)
        this.interaction = null
        return await this.publishState()
      }
    } catch (cause: unknown) {
      this.running = false
      this.error = errorMessage(cause)
      await this.publishState()
    }
  }

  private async refresh(): Promise<void> {
    if (
      !vscode.workspace.isTrusted ||
      this.authentication.current?.loggedIn !== true ||
      this.authentication.current.routerCredential !== true
    ) {
      return this.publishState()
    }
    const cwd = workspaceDirectory()
    await this.refreshThreads(cwd)
    return this.publishState()
  }

  private async refreshThreads(cwd: string): Promise<void> {
    this.threads = (await this.appServer.listThreads(cwd)).threads
  }

  private async openThread(threadId: string): Promise<void> {
    const cwd = workspaceDirectory()
    await this.appServer.resumeThread(cwd, exactText(threadId, "threadId"))
    this.threadId = threadId
    this.turnId = null
    this.messages = []
    this.running = false
    this.interaction = null
    this.error = null
    await this.publishState()
  }

  private async send(submissionId: string, text: string): Promise<void> {
    const prompt = exactText(text, "message")
    if (!this.threadId) await this.newThread()
    const threadId = this.threadId
    if (!threadId) throw new Error("CodeM could not create a thread")
    this.error = null
    this.running = true
    this.messages.push({ id: submissionId, role: "user", text: prompt, pending: false })
    await this.publishState()
    await this.appServer.startTurn(workspaceDirectory(), threadId, exactText(submissionId, "submissionId"), prompt)
  }

  private acceptEvent(event: AppServerHostEvent): void {
    if ("threadId" in event && event.threadId !== null && this.threadId && event.threadId !== this.threadId) return
    if (event.type === "turn-started") {
      this.turnId = event.turnId
      this.running = true
    } else if (event.type === "text-delta") {
      this.appendAssistantDelta(event.itemId, event.delta)
    } else if (event.type === "turn-completed") {
      this.running = false
      this.interaction = null
      this.messages = this.messages.map((message) => ({ ...message, pending: false }))
      if (event.outcome === "failed") this.error = event.error ?? `CodeM stopped: ${event.stopReason}`
      void this.refreshThreads(workspaceDirectory()).then(() => this.publishState())
    } else if (event.type === "interaction") {
      this.interaction = event.interaction
    } else if (event.type === "interaction-resolved") {
      if (this.interaction?.requestId === event.requestId) this.interaction = null
    } else if (event.type === "warning" || event.type === "protocol-error") {
      this.error = event.message
    } else if (event.type === "connection-closed" && !event.exit.expected) {
      this.running = false
      this.error = `CodeM Core exited unexpectedly (${event.exit.code ?? event.exit.signal ?? "unknown"}).`
    }
    void this.post({ type: "event", event })
    void this.publishState()
  }

  private appendAssistantDelta(itemId: string, delta: string): void {
    const index = this.messages.findIndex((message) => message.id === itemId)
    if (index === -1) {
      this.messages.push({ id: itemId, role: "assistant", text: delta, pending: true })
      return
    }
    const current = this.messages[index]
    this.messages[index] = { ...current, text: `${current.text}${delta}`, pending: true }
  }

  private async publishState(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0]
    await this.post({
      type: "state",
      state: {
        authenticated:
          this.authentication.current?.loggedIn === true && this.authentication.current.routerCredential === true,
        trusted: vscode.workspace.isTrusted,
        workspaceName: folder?.name ?? null,
        threadId: this.threadId,
        threads: this.threads,
        messages: this.messages,
        running: this.running,
        error: this.error,
        interaction: this.interaction,
      },
    })
  }

  private post(message: CodeMHostToWebviewMessage): Thenable<boolean> {
    return this.view?.webview.postMessage(message) ?? Promise.resolve(false)
  }

  private html(webview: vscode.Webview): string {
    const nonce = cryptoNonce()
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "codem-webview.js"))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "codem-webview.css"))
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"><title>CodeM</title></head><body><div id="root"></div><script nonce="${nonce}" type="module" src="${script}"></script></body></html>`
  }
}

function workspaceDirectory(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error("Open a workspace folder before starting CodeM.")
  return folder.uri.fsPath
}

function parseMessage(value: unknown): CodeMWebviewToHostMessage {
  if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") {
    throw new Error("CodeM webview sent an invalid message")
  }
  return value as CodeMWebviewToHostMessage
}

function exactText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error(`Invalid CodeM ${label}`)
  return value
}

function cryptoNonce(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "CodeM operation failed"
}
