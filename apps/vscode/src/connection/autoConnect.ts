import * as vscode from "vscode"

export interface AutoConnectTarget {
  signedIn(): boolean
  /** Whether a chat surface is open; activating the extension alone never connects. */
  surfaceAvailable(): boolean
  connect(): Promise<void>
}

/**
 * Owns the one automatic connection attempt of an activation. It runs when a chat surface is ready, trust is
 * granted or `codem.autoConnect` changes, and only for a signed-in account, an open surface and a trusted
 * workspace with a folder. A failed attempt is not repeated; the user retries explicitly. Signing out allows
 * the next account one attempt again.
 */
export class AutoConnect implements vscode.Disposable {
  private attempted = false
  private readonly target: AutoConnectTarget
  private readonly subscriptions: vscode.Disposable[]
  constructor(target: AutoConnectTarget) {
    this.target = target
    this.subscriptions = [
      vscode.workspace.onDidGrantWorkspaceTrust(() => { void this.run() }),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("codem.autoConnect")) void this.run() }),
    ]
  }
  async run(): Promise<void> {
    if (!this.target.signedIn() || this.attempted || !this.target.surfaceAvailable() || !vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length) return
    if (!vscode.workspace.getConfiguration("codem").get<boolean>("autoConnect", true)) return
    this.attempted = true
    await this.target.connect()
  }
  reset(): void { this.attempted = false }
  dispose(): void { for (const subscription of this.subscriptions) subscription.dispose() }
}
