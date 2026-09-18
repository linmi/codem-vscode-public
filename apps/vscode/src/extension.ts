import * as vscode from "vscode"
import { basename } from "node:path"
import { CodeMProvider } from "./CodeMProvider"
import { AgentManagerProvider } from "./agent-manager/AgentManagerProvider"
import { VscodeHost } from "./agent-manager/vscode-host"
import { DiffViewerProvider } from "./diff/DiffViewerProvider"
import { DocumentViewerProvider } from "./DocumentViewerProvider"
import { DiffSourceCatalog } from "./diff/sources/catalog"
import { DiffVirtualProvider } from "./DiffVirtualProvider"
import { SettingsEditorProvider } from "./SettingsEditorProvider"
import { SubAgentViewerProvider } from "./SubAgentViewerProvider"
import { EXTENSION_DISPLAY_NAME } from "./constants"
import { KiloConnectionService } from "./services/cli-backend"
import { registerAutocompleteProvider } from "./services/autocomplete"
import { ensureBackendForAutocomplete } from "./services/autocomplete/ensure-backend"
import { AutocompleteServiceManager } from "./services/autocomplete/AutocompleteServiceManager"
import { AttentionService, showOSNotification } from "./services/attention"
import { CaffeinationService } from "./services/caffeination"
import { confirmCaffeination } from "./services/caffeination/confirm"
import { createCaffeinationDriver } from "./services/caffeination/inhibitor"
import { BrowserBroker } from "./services/browser-automation"
import { registerCommitMessageService } from "./services/commit-message"
import { registerCodeActions, registerTerminalActions, KiloCodeActionProvider } from "./services/code-actions"
import { registerHeapSnapshot } from "./commands/heap-snapshot"
import { RemoteStatusService } from "./services/RemoteStatusService"
import { markWorkspace } from "./util/spotlight"
import { createNotebookBridge } from "./services/notebook"
import { createGitExecutable } from "./util/git-executable"
import { isCursorHost } from "./utils"
import { sameDirectory } from "./host/utils"
import { CodeMAuthenticationService } from "./services/app-server/authentication"
import { CodeMAppServerService } from "./services/app-server/service"
import { registerSpaceSelector } from "./services/app-server/spaces-ui"

let agentManager: AgentManagerProvider | undefined
let caffeination: CaffeinationService | undefined
let shuttingDown = false

const RESTORE_KEY = "kilo.workbench.restore"

type RestoreState = {
  agentManager?: boolean
}

const panelTitleHandler = (panel: vscode.WebviewPanel) => (title: string) => {
  panel.title = title || EXTENSION_DISPLAY_NAME
}

// Activated via "onStartupFinished" and "onUri" (package.json) so that commands, code actions,
// keybindings, autocomplete, commit-message generation, and URI deep links all work immediately —
// without requiring the user to open a CodeM sidebar or panel first. Activation briefly invokes the
// credential broker to read auth status; the live agent backend still starts lazily.
export async function activate(context: vscode.ExtensionContext) {
  console.log("CodeM extension is now active")
  shuttingDown = false

  // Drives the "!codem.isCursor" guards on the native view/title and
  // editor/title menu contributions — see isCursorHost() for why.
  void vscode.commands.executeCommand("setContext", "codem.isCursor", isCursorHost())
  const codeMAuthentication = new CodeMAuthenticationService(context)
  const codeMAppServer = new CodeMAppServerService(context, codeMAuthentication)
  context.subscriptions.push(
    codeMAuthentication,
    codeMAppServer,
    registerSpaceSelector(codeMAppServer),
    vscode.commands.registerCommand("codem.signIn", () => codeMAuthentication.signIn()),
    vscode.commands.registerCommand("codem.signOut", () => codeMAuthentication.signOut()),
    vscode.commands.registerCommand("codem.refreshAuthentication", () => codeMAuthentication.refresh()),
    vscode.commands.registerCommand("codem.cancelSignIn", () => codeMAuthentication.cancelSignIn()),
  )
  void codeMAuthentication.initialize().catch((error: unknown) => {
    console.warn(
      "[CodeM] Authentication initialization failed:",
      error instanceof Error ? error.message : "unknown error",
    )
  })

  const browserBroker = new BrowserBroker({
    log: (...args) => console.warn("[CodeM] BrowserBroker:", ...args),
    enabled: () => vscode.workspace.getConfiguration("codem.experimental").get("browserAutomation", false),
    trusted: () => vscode.workspace.isTrusted,
    useSystemChrome: () => vscode.workspace.getConfiguration("codem.browserAutomation").get("useSystemChrome", true),
  })

  // Create shared connection service (one server for all webviews)
  const connectionService = new KiloConnectionService(context, () => browserBroker.env())
  const notebookBridge = createNotebookBridge(connectionService)
  let restore = context.workspaceState.get<RestoreState>(RESTORE_KEY) ?? {}
  const remember = (patch: RestoreState) => {
    const next = { ...restore, ...patch }
    if (shuttingDown && patch.agentManager === false) next.agentManager = restore.agentManager
    restore = next
    void context.workspaceState.update(RESTORE_KEY, restore)
  }

  // Create remote status service (one status bar item for all webviews)
  const remoteService = new RemoteStatusService()
  context.subscriptions.push(remoteService)
  connectionService.setRemoteService(remoteService)

  const unsubscribeStateChange = connectionService.onStateChange((state) => {
    if (state === "connected") {
      try {
        remoteService.setClient(connectionService.getClient())
        console.log("[CodeM] CLI connected, calling remoteService.refresh()")
        remoteService.refresh().catch((err) => console.warn("[CodeM] initial remote refresh failed:", err))
      } catch {
        remoteService.setClient(null)
      }
      AutocompleteServiceManager.getInstance()?.load()
    } else {
      remoteService.clearState()
      remoteService.setClient(null)
    }
  })

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    void markWorkspace(folder.uri.fsPath, (msg) => console.warn(`[CodeM] ${msg}`))
  }

  // Track all open tab panel providers so toolbar button commands can target them.
  // NOTE: The editor/title toolbar for tab panels intentionally omits Agent Manager
  // and Marketplace buttons (unlike the sidebar). Too many icons causes VS Code to
  // collapse them into a "..." overflow menu, hiding important buttons like Settings.
  const tabPanels = new Map<vscode.WebviewPanel, CodeMProvider>()
  const activeTabProvider = () => {
    for (const [panel, p] of tabPanels) {
      if (panel.active) return p
    }
    return undefined
  }

  // Create the provider with shared service
  const provider = new CodeMProvider(context.extensionUri, connectionService, context, {
    authentication: codeMAuthentication,
    appServer: codeMAppServer,
    focusContext: "codem.sidebarFocused",
  })
  provider.setRemoteService(remoteService)

  const deliver = (comments: unknown[], autoSend: boolean, sessionID?: string, directory?: string): void => {
    const target = sessionID
      ? [...tabPanels.values()].find((item) => {
          if (item.getCurrentSessionId() !== sessionID || !item.canReceiveReviewComments()) return false
          if (!directory) return true
          return [item.getSessionDirectories().get(sessionID), item.getSessionGitDirectory(sessionID)]
            .filter((value): value is string => value !== undefined)
            .some((value) => sameDirectory(value, directory))
        })
      : undefined
    const destination = target ?? provider
    void destination.appendReviewComments(comments, autoSend, sessionID)
  }
  provider.setReviewCommentsHandler(deliver)

  // Register the webview view provider for the sidebar.
  // retainContextWhenHidden keeps the webview alive when switching to other sidebar panels.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CodeMProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )

  // Ensure Agent Manager navigation keybindings work when a VS Code terminal has focus.
  // The terminal intercepts all keystrokes unless the command is listed in
  // terminal.integrated.commandsToSkipShell, which only contains built-in
  // commands by default.
  const skip = [
    "codem.agentManagerOpen",
    "codem.agentManager.showTerminal",
    "codem.agentManager.previousTerminal",
    "codem.agentManager.nextTerminal",
  ]
  if (process.platform === "darwin") skip.push("codem.agentManager.runScript")
  ensureCommandsSkipShell(skip)

  // Create Agent Manager provider for editor panel
  const reason = vscode.env.remoteName ? "Keep Awake is only available in a local VS Code window." : undefined
  const awake = new CaffeinationService(connectionService, createCaffeinationDriver({ reason }))
  caffeination = awake
  let previous = awake.getState()
  const unsubscribeCaffeination = awake.onChange((state) => {
    const prior = previous
    previous = state
    if (state.error && state.error !== prior.error) {
      void vscode.window.showErrorMessage(`Keep Awake stopped: ${state.error}`)
      return
    }
    if (state.enabled === prior.enabled) return
    void vscode.window.showInformationMessage(
      state.enabled ? "Keep Awake enabled. CodeM will prevent system sleep while agents work." : "Keep Awake disabled.",
    )
  })
  context.subscriptions.push({ dispose: unsubscribeCaffeination })
  const toggle = confirmCaffeination(awake, async () => {
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showWarningMessage("Trust this workspace before enabling Keep Awake.")
      return false
    }
    if (context.globalState.get<boolean>("caffeination.confirmed") === true) return true
    const detail = [
      "Keep Awake prevents system sleep while CodeM sessions are in progress, including some waits for approval. It does not keep the display on or disable screen locking. It turns off when this VS Code window reloads.",
      "Agents may continue to access files, network services, and available credentials while the computer is locked. Enable only if your organization's device policy permits it.",
      ...(process.platform === "linux"
        ? ["On Linux, this can also block manual suspend. Turn Keep Awake off before suspending."]
        : []),
    ].join("\n\n")
    const answer = await vscode.window.showWarningMessage(
      "Keep this computer awake while CodeM agents work?",
      { modal: true, detail },
      "Enable Keep Awake",
    )
    if (answer !== "Enable Keep Awake") return false
    await context.globalState.update("caffeination.confirmed", true).then(undefined, (error: unknown) => {
      console.warn("[CodeM] Could not save Keep Awake confirmation:", error)
    })
    return true
  })
  const controls = {
    getState: () => awake.getState(),
    onChange: awake.onChange.bind(awake),
    setEnabled: toggle,
  }
  const git = createGitExecutable({
    preferred: async () => {
      const extension = vscode.extensions.getExtension("vscode.git")
      if (!extension) return undefined
      if (!extension.isActive) await extension.activate()
      return extension.exports?.getAPI(1).git.path
    },
    log: (message) => console.warn(`[CodeM] ${message}`),
  })
  const binary = process.platform === "win32" ? await git() : git
  const agentManagerHost = new VscodeHost(
    context.extensionUri,
    connectionService,
    context,
    remoteService,
    controls,
    codeMAuthentication,
    codeMAppServer,
  )
  const agentManagerProvider = new AgentManagerProvider(agentManagerHost, connectionService, binary, browserBroker)
  agentManagerProvider.onPanelVisibilityChange((visible) => remember({ agentManager: visible }))
  agentManager = agentManagerProvider
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codem.experimental.browserAutomation")) {
        agentManagerProvider.refreshBrowserAutomation()
      }
    }),
  )
  context.subscriptions.push(agentManagerProvider)

  // Wire "Continue in Worktree" from sidebar → Agent Manager
  provider.setContinueInWorktreeHandler((sessionId, progress) =>
    agentManagerProvider.continueFromSidebar(sessionId, progress),
  )
  provider.setCreateWorktreeHandler((baseBranch, branchName) =>
    agentManagerProvider.createFromSidebar(baseBranch, branchName),
  )

  const attention = new AttentionService(connectionService, {
    details: async (sessionID, directory) => {
      provider.rememberSession(sessionID, directory)
      const session = await provider.getSessionInfo(sessionID)
      const dir = directory ?? session?.directory
      const workspace = dir
        ? (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir))?.name ?? basename(dir))
        : (vscode.workspace.name ?? "Workspace")
      return { workspace, session: session?.title ?? session?.slug ?? sessionID }
    },
    focused: () => vscode.window.state.focused,
    // Every surface already reports the session it displays, gated on its own
    // visibility, so this covers the sidebar, CodeM editor tabs, and Agent
    // Manager without each one needing its own accessor.
    visible: (sessionID) => connectionService.isVisible(sessionID),
    os: showOSNotification,
    show: async (sessionID, directory) => {
      if (await agentManagerProvider.revealSession(sessionID)) return
      await vscode.commands.executeCommand("codem.SidebarProvider.focus")
      await provider.openSession(sessionID, directory)
    },
  })

  // Autocomplete must not start kilo serve; the helper is now a no-op.
  ensureBackendForAutocomplete(connectionService)

  // Register serializer so Agent Manager restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(AgentManagerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        if (restore.agentManager === false) {
          panel.dispose()
          return Promise.resolve()
        }
        const ctx = agentManagerHost.wrapExistingPanel(panel, {
          onBeforeMessage: (msg) => agentManagerProvider.handleMessage(msg),
          worktreeDirectories: () => agentManagerProvider.getWorktreeDirectories(),
          workspaceRoot: () => agentManagerProvider.workspaceRoot(),
          projectId: () => agentManagerProvider.projectId(),
        })
        agentManagerProvider.deserializePanel(ctx)
        return Promise.resolve()
      },
    }),
  )

  const attach = (panel: vscode.WebviewPanel) => {
    const tabProvider = new CodeMProvider(context.extensionUri, connectionService, context, {
      authentication: codeMAuthentication,
      appServer: codeMAppServer,
      tabTitle: panelTitleHandler(panel),
      topBarSurface: "tab",
    })
    tabProvider.setRemoteService(remoteService)
    tabProvider.setContinueInWorktreeHandler((sessionId, progress) =>
      agentManagerProvider.continueFromSidebar(sessionId, progress),
    )
    tabProvider.setCreateWorktreeHandler((baseBranch, branchName) =>
      agentManagerProvider.createFromSidebar(baseBranch, branchName),
    )
    tabProvider.setDiffVirtualProvider(diffVirtualProvider)
    tabProvider.setDiffViewerProvider(diffViewerProvider)
    tabProvider.setReviewCommentsHandler(deliver)
    tabProvider.resolveWebviewPanel(panel)
    tabPanels.set(panel, tabProvider)
    return tabProvider
  }

  // Register serializer so "Open in Tab" restores when VS Code restarts
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("codem.TabPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        const tabProvider = attach(panel)
        panel.onDidDispose(
          () => {
            console.log("[CodeM] Tab panel restored from restart disposed")
            tabPanels.delete(panel)
            tabProvider.dispose()
          },
          null,
          context.subscriptions,
        )
        return Promise.resolve()
      },
    }),
  )

  const diffSourceCatalog = new DiffSourceCatalog(connectionService)
  context.subscriptions.push(diffSourceCatalog)
  const diffViewerProvider = new DiffViewerProvider(context.extensionUri, connectionService, diffSourceCatalog, {
    sessionIdProvider: () => provider.getCurrentSessionId(),
    sessionDirectoryProvider: (sessionId) => provider.getSessionGitDirectory(sessionId),
  })
  diffViewerProvider.setCommentHandler((comments, autoSend) => {
    void provider.appendReviewComments(comments, autoSend)
  })
  provider.setDiffViewerProvider(diffViewerProvider)
  context.subscriptions.push(diffViewerProvider)

  const documentViewerProvider = new DocumentViewerProvider(context.extensionUri, connectionService, {
    onComments: (comments, autoSend) => void provider.appendReviewComments(comments, autoSend),
  })
  provider.setDocumentViewerProvider(documentViewerProvider)
  context.subscriptions.push(documentViewerProvider)

  // Create diff virtual provider (lightweight single-file diff for permission approval)
  const diffVirtualProvider = new DiffVirtualProvider(context.extensionUri)
  provider.setDiffVirtualProvider(diffVirtualProvider)
  agentManagerHost.setDiffVirtualProvider(diffVirtualProvider)
  context.subscriptions.push(diffVirtualProvider)

  // Create standalone editor providers (open in editor area, not sidebar)
  const settingsEditorProvider = new SettingsEditorProvider(
    context.extensionUri,
    connectionService,
    context,
    codeMAuthentication,
    codeMAppServer,
    { ...agentManagerProvider.settings },
  )
  settingsEditorProvider.setRemoteService(remoteService)
  context.subscriptions.push(settingsEditorProvider)

  // Create sub-agent viewer provider (read-only editor panel for sub-agent sessions)
  const subAgentViewerProvider = new SubAgentViewerProvider(
    context.extensionUri,
    connectionService,
    context,
    codeMAuthentication,
    codeMAppServer,
  )
  context.subscriptions.push(subAgentViewerProvider)

  // Register serializers so standalone panels restore on restart
  const settingsViews = ["settingsPanel", "profilePanel"] as const
  for (const suffix of settingsViews) {
    context.subscriptions.push(
      vscode.window.registerWebviewPanelSerializer(`codem.${suffix}`, {
        deserializeWebviewPanel(panel: vscode.WebviewPanel) {
          settingsEditorProvider.deserializePanel(panel)
          return Promise.resolve()
        },
      }),
    )
  }

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DocumentViewerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        panel.dispose()
        return Promise.resolve()
      },
    }),
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(DiffViewerProvider.viewType, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        diffViewerProvider.deserializePanel(panel)
        return Promise.resolve()
      },
    }),
  )

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("codem.SubAgentViewerPanel", {
      deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        // Sub-agent viewer requires a session ID that can't be recovered
        // after restart, so dispose the stale panel cleanly.
        panel.dispose()
        return Promise.resolve()
      },
    }),
  )

  // Register toolbar button command handlers
  context.subscriptions.push(
    vscode.commands.registerCommand("codem.sidebarTitle.plusButtonClicked", () =>
      vscode.commands.executeCommand("codem.plusButtonClicked"),
    ),
    vscode.commands.registerCommand("codem.sidebarTitle.historyButtonClicked", () =>
      vscode.commands.executeCommand("codem.historyButtonClicked"),
    ),
    vscode.commands.registerCommand("codem.sidebarTitle.agentManagerOpen", () =>
      vscode.commands.executeCommand("codem.agentManagerOpen"),
    ),
    vscode.commands.registerCommand("codem.sidebarTitle.profileButtonClicked", () =>
      vscode.commands.executeCommand("codem.profileButtonClicked"),
    ),
    vscode.commands.registerCommand("codem.sidebarTitle.settingsButtonClicked", () =>
      vscode.commands.executeCommand("codem.settingsButtonClicked"),
    ),
    vscode.commands.registerCommand("codem.plusButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "plusButtonClicked" })
      else provider.postMessage({ type: "action", action: "plusButtonClicked" })
    }),
    vscode.commands.registerCommand("codem.agentManagerOpen", () => {
      agentManagerProvider.openPanel()
    }),
    vscode.commands.registerCommand("codem.historyButtonClicked", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "historyButtonClicked" })
      else provider.postMessage({ type: "action", action: "historyButtonClicked" })
    }),
    vscode.commands.registerCommand("codem.selectPermissionMode", () => {
      const tab = activeTabProvider()
      ;(tab ?? provider).postMessage({ type: "action", action: "selectPermissionMode" })
      agentManagerProvider.postMessage({ type: "action", action: "selectPermissionMode" })
    }),
    vscode.commands.registerCommand("codem.cycleAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cycleAgentMode" })
      else provider.postMessage({ type: "action", action: "cycleAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cycleAgentMode" })
    }),
    vscode.commands.registerCommand("codem.cyclePreviousAgentMode", () => {
      const tab = activeTabProvider()
      if (tab) tab.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      else provider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
      agentManagerProvider.postMessage({ type: "action", action: "cyclePreviousAgentMode" })
    }),
    vscode.commands.registerCommand("codem.profileButtonClicked", () => {
      settingsEditorProvider.openPanel("profile")
    }),
    vscode.commands.registerCommand("codem.settingsButtonClicked", (tab?: string, projectId?: string) => {
      settingsEditorProvider.openPanel("settings", tab, projectId)
    }),
    vscode.commands.registerCommand("codem.openIndexingSettings", () => {
      void vscode.window.showWarningMessage("尚未迁移到 CodeM App Server: indexing")
    }),
    vscode.commands.registerCommand("codem.showMemory", async () => {
      void vscode.window.showWarningMessage("尚未迁移到 CodeM App Server: memory")
    }),
    vscode.commands.registerCommand("codem.toggleMemory", async () => {
      void vscode.window.showWarningMessage("尚未迁移到 CodeM App Server: memory")
    }),
    vscode.commands.registerCommand("codem.toggleCaffeination", (enabled?: boolean) => {
      const state = awake.getState()
      const next = typeof enabled === "boolean" ? enabled : !(state.enabled || state.active)
      if (next && !state.available) {
        return vscode.window.showWarningMessage(state.error ?? "Keep Awake is unavailable on this platform.")
      }
      return toggle(next)
    }),
    vscode.commands.registerCommand("codem.generateTerminalCommand", async () => {
      const input = await vscode.window.showInputBox({
        prompt: "Describe the terminal command you want to generate",
        placeHolder: "e.g., find all .ts files modified in the last 24 hours",
      })
      if (!input) return
      await vscode.commands.executeCommand("codem.SidebarProvider.focus")
      await provider.waitForReady()
      provider.postMessage({ type: "triggerTask", text: `Generate a terminal command: ${input}` })
    }),
    vscode.commands.registerCommand("codem.toggleRemote", () => {
      remoteService.toggle().catch((err) => console.error("[CodeM] toggleRemote command failed:", err))
    }),
    vscode.commands.registerCommand("codem.openInTab", () => {
      return openKiloInNewTab(context, tabPanels, attach)
    }),
    vscode.commands.registerCommand(
      "codem.showChanges",
      (arg?: Parameters<DiffViewerProvider["openFromCommand"]>[0]) => {
        diffViewerProvider.openFromCommand(arg)
      },
    ),
    vscode.commands.registerCommand(
      "codem.openSubAgentViewer",
      (sessionID: string, title?: string, directory?: string) => {
        subAgentViewerProvider.openPanel(sessionID, title, directory)
      },
    ),
    vscode.commands.registerCommand("codem.agentManager.previousSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionPrevious" })
    }),
    vscode.commands.registerCommand("codem.agentManager.nextSession", () => {
      agentManagerProvider.postMessage({ type: "action", action: "sessionNext" })
    }),
    vscode.commands.registerCommand("codem.agentManager.previousTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabPrevious" })
    }),
    vscode.commands.registerCommand("codem.agentManager.nextTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "tabNext" })
    }),
    vscode.commands.registerCommand("codem.agentManager.previousTerminal", () => {
      agentManagerProvider.postMessage({ type: "action", action: "terminalPrevious" })
    }),
    vscode.commands.registerCommand("codem.agentManager.nextTerminal", () => {
      agentManagerProvider.postMessage({ type: "action", action: "terminalNext" })
    }),
    vscode.commands.registerCommand("codem.agentManager.search", () => {
      agentManagerProvider.postMessage({ type: "action", action: "search" })
    }),
    vscode.commands.registerCommand("codem.agentManager.showTerminal", () => {
      // Route through the webview so it can reach into the active session
      // state and open the VS Code integrated terminal for it.
      agentManagerProvider.postMessage({ type: "action", action: "showTerminal" })
    }),
    vscode.commands.registerCommand("codem.agentManager.runScript", () => {
      agentManagerProvider.postMessage({ type: "action", action: "runScript" })
    }),
    vscode.commands.registerCommand("codem.agentManager.toggleDiff", () => {
      agentManagerProvider.postMessage({ type: "action", action: "toggleDiff" })
    }),
    vscode.commands.registerCommand("codem.agentManager.showShortcuts", () => {
      agentManagerProvider.postMessage({ type: "action", action: "showShortcuts" })
    }),

    vscode.commands.registerCommand("codem.agentManager.newTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTab" })
    }),
    vscode.commands.registerCommand("codem.agentManager.newTerminalTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newTerminalTab" })
    }),
    vscode.commands.registerCommand("codem.agentManager.newSideTerminal", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newSideTerminal" })
    }),
    vscode.commands.registerCommand("codem.agentManager.closeTab", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeTab" })
    }),
    vscode.commands.registerCommand("codem.agentManager.newWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "newWorktree" })
    }),
    vscode.commands.registerCommand("codem.agentManager.quickWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "quickWorktree" })
    }),
    vscode.commands.registerCommand("codem.agentManager.openWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "openWorktree" })
    }),
    vscode.commands.registerCommand("codem.agentManager.updateFromBase", () => {
      agentManagerProvider.postMessage({ type: "action", action: "updateFromBase" })
    }),
    vscode.commands.registerCommand("codem.agentManager.openPR", () => {
      agentManagerProvider.postMessage({ type: "action", action: "openPR" })
    }),
    vscode.commands.registerCommand("codem.agentManager.closeWorktree", () => {
      agentManagerProvider.postMessage({ type: "action", action: "closeWorktree" })
    }),
    vscode.commands.registerCommand("codem.agentManager.advancedWorktree", () =>
      agentManagerProvider.openAdvancedWorktree(),
    ),
    ...Array.from({ length: 9 }, (_, i) =>
      vscode.commands.registerCommand(`codem.agentManager.jumpTo${i + 1}`, () => {
        agentManagerProvider.postMessage({ type: "action", action: `jumpTo${i + 1}` })
      }),
    ),
  )

  // Register URI handler for leftover deep links (vscode://codem.codem/kilocode/...).
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        const sessionMatch = uri.path.match(/^\/kilocode\/s\/([a-zA-Z0-9_-]+)$/)
        const sessionId = sessionMatch?.[1]
        if (sessionId) {
          console.log("[CodeM] URI handler: opening cloud session:", sessionId)
          await vscode.commands.executeCommand(`${CodeMProvider.viewType}.focus`)
          provider.openCloudSession(sessionId)
          return
        }

        if (uri.path !== "/kilocode/switch" && uri.path !== "/kilocode/model") return
        const params = new URLSearchParams(uri.query)
        const modelID = params.get("model") || undefined
        const agent = params.get("agent") || undefined
        if (!modelID && !agent) return
        console.log("[CodeM] URI handler: applying linked CodeM selection:", { modelID, agent })
        await vscode.commands.executeCommand(`${CodeMProvider.viewType}.focus`)
        provider.selectKiloModel(modelID, agent)
      },
    }),
  )

  // Register autocomplete provider
  void registerAutocompleteProvider(context, connectionService)

  // Register commit message generation
  registerCommitMessageService(context, connectionService)

  registerHeapSnapshot(context, connectionService)

  context.subscriptions.push(
    vscode.commands.registerCommand("codem.reload", () => {
      provider.reload().catch((e) => console.error("[CodeM] reload command failed:", e))
    }),
  )

  // Register code actions (editor context menus, terminal context menus, keyboard shortcuts)
  registerCodeActions(context, provider, agentManagerProvider, activeTabProvider)
  registerTerminalActions(context, provider, agentManagerProvider)

  // Register CodeActionProvider (lightbulb quick fixes)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new KiloCodeActionProvider(),
      KiloCodeActionProvider.metadata,
    ),
  )

  // Dispose services when extension deactivates (kills the server)
  context.subscriptions.push({
    dispose: () => {
      shuttingDown = true
      void caffeination?.dispose().catch((error: unknown) => {
        console.warn("[CodeM] Keep-awake cleanup failed:", error)
      })
      unsubscribeStateChange()
      attention.dispose()
      browserBroker.dispose()
      provider.dispose()
      notebookBridge.dispose()
      connectionService.dispose()
    },
  })
}

export async function deactivate() {
  shuttingDown = true
  const results = await Promise.allSettled([caffeination?.dispose(), agentManager?.shutdown()])
  for (const result of results) {
    if (result.status === "rejected") console.warn("[CodeM] Extension shutdown failed:", result.reason)
  }
}

function openKiloInNewTab(
  context: vscode.ExtensionContext,
  tabPanels: Map<vscode.WebviewPanel, CodeMProvider>,
  attach: (panel: vscode.WebviewPanel) => CodeMProvider,
) {
  const panel = vscode.window.createWebviewPanel("codem.TabPanel", EXTENSION_DISPLAY_NAME, vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [context.extensionUri],
  })

  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "codem-light.svg"),
    dark: vscode.Uri.joinPath(context.extensionUri, "assets", "icons", "codem-dark.svg"),
  }

  const tabProvider = attach(panel)

  panel.onDidDispose(
    () => {
      console.log("[CodeM] Tab panel disposed")
      tabPanels.delete(panel)
      tabProvider.dispose()
    },
    null,
    context.subscriptions,
  )
}

/**
 * Add extension commands to terminal.integrated.commandsToSkipShell so they
 * work when a VS Code terminal has focus. The setting only ships with built-in
 * commands; extension commands must be added explicitly.
 */
function ensureCommandsSkipShell(commands: string[]): void {
  const config = vscode.workspace.getConfiguration("terminal.integrated")
  const info = config.inspect<string[]>("commandsToSkipShell")
  // Update whichever scope already carries an override so we don't
  // shadow workspace settings or leak workspace values into global.
  const [existing, target] = info?.workspaceFolderValue
    ? [info.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder]
    : info?.workspaceValue
      ? [info.workspaceValue, vscode.ConfigurationTarget.Workspace]
      : [info?.globalValue ?? [], vscode.ConfigurationTarget.Global]
  const missing = commands.filter((cmd) => !existing.includes(cmd))
  if (missing.length === 0) return
  config.update("commandsToSkipShell", [...existing, ...missing], target)
}
