import type { KiloConnectionService } from "../services/cli-backend"
import type { GitExecutable } from "../util/git-executable"
import type { BrowserBroker } from "../services/browser-automation"
import { createSettingsHandler, type SettingsHandler } from "./project/settings"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"
import type { Host, PanelContext, OutputHandle, Disposable } from "./host"
import { focusPanelPrompt, revealPanel } from "./focus-panel"

const UNMIGRATED = "尚未迁移到 CodeM App Server"

/**
 * Host-side Agent Manager panel.
 *
 * Worktree / Kilo-session / PTY / setup-script orchestration is retired.
 * The webview shell still loads; inbound host commands fail closed so the
 * UI stays, but leftover kilo serve work does not run.
 */
export class AgentManagerProvider implements Disposable {
  public static readonly viewType = "codem.AgentManagerPanel"
  private panel: PanelContext | undefined
  private outputChannel: OutputHandle
  private closing: Promise<void> | undefined
  private onVisibilityChange: ((visible: boolean) => void) | undefined
  readonly settings: SettingsHandler

  constructor(
    private readonly host: Host,
    _connectionService: KiloConnectionService,
    _binary: GitExecutable | string = "git",
    _browser?: BrowserBroker,
  ) {
    this.outputChannel = this.host.createOutput("CodeM Agent Manager")
    this.settings = createSettingsHandler()
  }

  public openPanel(preserveFocus?: boolean): void {
    if (this.panel) {
      const panel = this.panel
      revealPanel(panel, preserveFocus, () =>
        focusPanelPrompt(panel, this.waitForPanelReady(panel), this.waitForPanelActive(panel)),
      )
      return
    }
    const panel = this.host.openPanel({
      onBeforeMessage: (msg) => this.onMessage(msg),
      worktreeDirectories: () => this.getWorktreeDirectories(),
      workspaceRoot: () => this.getRoot(),
      projectId: () => this.projectId(),
    })
    this.attachPanel(panel)
    if (!preserveFocus) focusPanelPrompt(panel, this.waitForPanelReady(panel), this.waitForPanelActive(panel))
  }

  public onPanelVisibilityChange(cb: (visible: boolean) => void): void {
    this.onVisibilityChange = cb
  }

  public deserializePanel(ctx: PanelContext): void {
    if (this.panel) {
      ctx.dispose()
      return
    }
    this.attachPanel(ctx)
  }

  public handleMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.onMessage(msg)
  }

  private attachPanel(ctx: PanelContext): void {
    if (this.panel) {
      const panel = this.panel
      this.panel = undefined
      panel.dispose()
    }
    this.panel = ctx
    this.onVisibilityChange?.(ctx.visible)
    ctx.onDidChangeVisibility((visible) => this.onVisibilityChange?.(visible))
    ctx.onDidDispose(() => {
      if (this.panel === ctx) this.panel = undefined
    })
    void this.pushShellState()
  }

  private async onMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const type = typeof msg.type === "string" ? msg.type : ""
    if (!type.startsWith("agentManager.")) return msg
    const inbound = msg as AgentManagerInMessage
    if (inbound.type === "agentManager.requestState" || inbound.type === "agentManager.requestProjects") {
      await this.pushShellState()
      return null
    }
    this.host.showError(`${UNMIGRATED}: ${inbound.type}`)
    return null
  }

  private async pushShellState(): Promise<void> {
    const root = this.getRoot()
    const projectId = root ? "workspace" : undefined
    this.postToWebview({
      type: "agentManager.projects",
      multiProject: this.host.multiProject(),
      projects: root
        ? [
            {
              id: "workspace",
              root,
              label: root.split(/[\\/]/).pop() || root,
              pinned: true,
              active: true,
              expanded: true,
              initialized: true,
              missing: false,
            },
          ]
        : [],
    })
    this.postToWebview({
      type: "agentManager.state",
      worktrees: [],
      sessions: [],
      sections: [],
      isGitRepo: false,
      projectId,
      terminalDestination: "vscode",
      browserAutomation: this.host.browserAutomation(),
    })
    this.postToWebview({
      type: "agentManager.repoInfo",
      branch: "",
      projectId,
    })
  }

  public focusPanel(): void {
    const panel = this.panel
    if (!panel) return
    revealPanel(panel, false, () =>
      focusPanelPrompt(panel, this.waitForPanelReady(panel), this.waitForPanelActive(panel)),
    )
  }

  public isActive(): boolean {
    return this.panel?.active === true
  }

  private async waitForPanel(panel: PanelContext, promise: Promise<void>): Promise<boolean> {
    const done = promise.then(() => true)
    let sub: Disposable | undefined
    const disposed = new Promise<false>((resolve) => {
      sub = panel.onDidDispose(() => {
        sub?.dispose()
        resolve(false)
      })
    })
    void done.finally(() => sub?.dispose())
    const ok = await Promise.race([done, disposed])
    return ok && this.panel === panel
  }

  private waitForPanelReady(panel: PanelContext): Promise<boolean> {
    return this.waitForPanel(panel, panel.waitForReady())
  }

  private waitForPanelActive(panel: PanelContext): Promise<boolean> {
    return this.waitForPanel(panel, panel.waitForActive())
  }

  public waitForReady(): Promise<boolean> {
    const panel = this.panel
    if (!panel) return Promise.resolve(false)
    return this.waitForPanelReady(panel)
  }

  public async showMemory(): Promise<void> {
    this.host.showError(`${UNMIGRATED}: memory`)
  }

  public async toggleMemory(): Promise<void> {
    this.host.showError(`${UNMIGRATED}: memory`)
  }

  public getSessionDirectories(): ReadonlyMap<string, string> {
    return this.panel?.sessions.getSessionDirectories() ?? new Map()
  }

  public async revealSession(_sessionId: string): Promise<boolean> {
    return false
  }

  public getWorktreeDirectories(): string[] {
    return []
  }

  public workspaceRoot = () => this.getRoot()

  public projectId = () => {
    return this.getRoot() ? "workspace" : undefined
  }

  public async continueFromSidebar(
    _sessionId: string,
    progress: (status: string, detail?: string, error?: string) => void,
  ): Promise<void> {
    progress("error", undefined, `${UNMIGRATED}: continueInWorktree`)
  }

  public async createFromSidebar(_baseBranch?: string, _branchName?: string): Promise<void> {
    this.openPanel()
    this.host.showError(`${UNMIGRATED}: createWorktree`)
  }

  public async openAdvancedWorktree(): Promise<void> {
    this.openPanel()
    this.host.showError(`${UNMIGRATED}: createWorktree`)
  }

  private postToWebview(message: AgentManagerOutMessage): void {
    this.panel?.postMessage(message)
  }

  public postMessage(message: unknown): void {
    this.panel?.postMessage(message)
  }

  public shutdown(): Promise<void> {
    if (!this.closing) this.closing = this.disposeAsync()
    return this.closing
  }

  public dispose(): void {
    void this.shutdown()
  }

  public refreshBrowserAutomation(): void {
    void this.pushShellState()
  }

  private async disposeAsync(): Promise<void> {
    this.panel?.dispose()
    this.panel = undefined
    this.outputChannel.dispose()
  }

  private getRoot(): string | undefined {
    return this.host.workspacePath()
  }
}
