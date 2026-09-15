import * as vscode from "vscode"
import { CodeMProvider } from "./CodeMProvider"
import { CodeMAuthenticationService } from "./services/app-server/authentication"
import { CodeMAppServerService } from "./services/app-server/service"

let appServer: CodeMAppServerService | null = null

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log("CodeM extension is active")

  const authentication = new CodeMAuthenticationService(context)
  appServer = new CodeMAppServerService(context, authentication)
  const provider = new CodeMProvider(context.extensionUri, appServer, authentication)

  context.subscriptions.push(
    authentication,
    appServer,
    provider,
    vscode.window.registerWebviewViewProvider(CodeMProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("codem.signIn", () => authentication.signIn()),
    vscode.commands.registerCommand("codem.signOut", () => authentication.signOut()),
    vscode.commands.registerCommand("codem.refreshAuthentication", () => authentication.refresh()),
    vscode.commands.registerCommand("codem.plusButtonClicked", () => provider.newThread()),
    vscode.commands.registerCommand("codem.sidebarTitle.plusButtonClicked", () => provider.newThread()),
    vscode.commands.registerCommand("codem.historyButtonClicked", () =>
      vscode.commands.executeCommand("codem.SidebarProvider.focus"),
    ),
    vscode.commands.registerCommand("codem.sidebarTitle.historyButtonClicked", () =>
      vscode.commands.executeCommand("codem.SidebarProvider.focus"),
    ),
    vscode.commands.registerCommand("codem.profileButtonClicked", () =>
      vscode.commands.executeCommand("codem.SidebarProvider.focus"),
    ),
    vscode.commands.registerCommand("codem.sidebarTitle.profileButtonClicked", () =>
      vscode.commands.executeCommand("codem.SidebarProvider.focus"),
    ),
    vscode.commands.registerCommand("codem.settingsButtonClicked", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:codem.codem"),
    ),
    vscode.commands.registerCommand("codem.sidebarTitle.settingsButtonClicked", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "@ext:codem.codem"),
    ),
  )

  void authentication.initialize().catch((error: unknown) => {
    console.warn("[CodeM] Authentication initialization failed:", error instanceof Error ? error.message : error)
  })
}

export async function deactivate(): Promise<void> {
  appServer?.dispose()
  appServer = null
}
