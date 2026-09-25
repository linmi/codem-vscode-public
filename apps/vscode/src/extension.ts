import { AccountController } from "./connection/accountController.ts"
import { accountOperations } from "./connection/runtimeAccount.ts"
import { EditorSelection } from "./integrations/editorSelection.ts"
import { registerGitActions } from "./integrations/gitActions.ts"
import { registerInlineCompletion } from "./integrations/inlineCompletion.ts"
import { registerTerminalActions } from "./integrations/terminalActions.ts"
import { ChatSurfaces } from "./chat/chatSurfaces.ts"
import { registerEditorActions } from "./integrations/editorActions.ts"
import { EditorReview } from "./integrations/editorReview.ts"
import { NextEdit } from "./integrations/nextEdit/nextEdit.ts"
import { ConnectionPreferences } from "./connection/connectionPreferences.ts"
import { ActiveConversation } from "./sessionHistory/activeConversation.ts"
import * as vscode from "vscode"
import { createBundledAppServerRuntimeResolver } from "@codem/app-server"
import type { SpaceDirectory } from "./connection/spaceDirectory.ts"
import { ChatController } from "./chat/chatController.ts"
import { UserVisibleError } from "./shared/userVisibleError.ts"
import { assertTrusted, connectRuntime } from "./connection/runtimeSession.ts"
import { showInteraction } from "./panels/interactions.ts"
import type { ChatSnapshot } from "./shared/messages.ts"
import { AutoConnect } from "./connection/autoConnect.ts"
import { ChatLog } from "./chat/chatLog.ts"
import { ViewActionRouter } from "./chat/viewActionRouter.ts"
import { PanelBroker } from "./panels/panelBroker.ts"

import { NativeFeatures } from "./integrations/nativeFeatures.ts"

/** The only module state: each activation's asynchronous disposal, which deactivate awaits. VS Code does not await `context.subscriptions`. */
const deactivations = new Set<() => Promise<unknown>>()

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodeM")
  const log = (line: string) => output.appendLine(line)
  // One verifier per extension host: account reads and connections reuse a digest only
  // while the bundled executable is unchanged; the manifest check runs on every call.
  const runtime = createBundledAppServerRuntimeResolver({
    extensionRoot: context.extensionPath,
    observe: ({ elapsedMs, hashed, reused }) => log(`Runtime integrity: ${elapsedMs}ms; hashed ${hashed}, reused ${reused}`),
  })
  const preferences = new ConnectionPreferences(context.workspaceState)
  const features = new NativeFeatures(context.secrets)
  context.subscriptions.push(features)
  const panels = new PanelBroker()
  const surfaces = new ChatSurfaces(context, panels)
  const account = new AccountController(accountOperations(runtime, (stage, ms) => log(`Account ${stage}: ${ms}ms`)), state => {
    void vscode.commands.executeCommand("setContext", "codem.accountStatus", state.status)
    surfaces.post({ type: "account", state })
  })
  account.publish()
  const chatLog = new ChatLog(log)
  const chatStates = new vscode.EventEmitter<ChatSnapshot>()
  const openSession = async (signal: AbortSignal, target = preferences.lastConnection(), directory?: SpaceDirectory) => {
    const runtimeStarted = performance.now()
    const session = await connectRuntime(runtime, context.extension.packageJSON.version as string, signal, target, directory, status => { if (!signal.aborted) account.observe(status) })
    output.appendLine(`Connection runtime: ${Math.round(performance.now() - runtimeStarted)}ms`)
    try {
      const mcpStarted = performance.now()
      session.mcpServers = await features.loadMcp()
      output.appendLine(`Connection MCP settings: ${Math.round(performance.now() - mcpStarted)}ms`)
      return session
    } catch (error) { await session.host.close(); throw error }
  }
  const chat = new ChatController({
    preferences,
    authenticationInvalidated: () => account.invalidate(),
    activeConversation: new ActiveConversation(context.workspaceState),
    connected: session => preferences.remember({ cwd: session.cwd, workspace: session.workspace, key: session.space.key }),
    connect: async (signal) => {
      const session = await openSession(signal)
      session.host.onEvent((event) => {
        if (event.type === "turn-started") output.appendLine(JSON.stringify({ event: event.type, turnId: event.turnId, submissionId: event.submissionId }))
        if (event.type === "turn-completed") output.appendLine(JSON.stringify({ event: event.type, turnId: event.turnId, outcome: event.outcome, stopReason: event.stopReason }))
      })
      return session
    },
    assertTrusted: () => { assertTrusted(); if (!account.signedIn) throw new UserVisibleError("请先登录 CodeM。") },
    interact: async (request, signal, cwd) => {
      await surfaces.focus()
      return showInteraction(request, signal, panels, cwd)
    },
    requestApproval: (question, signal) => panels.request(question, signal),
    publish: state => chatStates.fire(state),
    report: (operation, error) => chatLog.report(operation, error),
  })
  const autoConnect = new AutoConnect({ signedIn: () => account.signedIn, surfaceAvailable: () => surfaces.available, connect: () => chat.connect() })
  context.subscriptions.push(autoConnect)
  const selection = new EditorSelection(value => surfaces.post({ type: "codeSelection", value }))
  context.subscriptions.push(selection)
  const router = new ViewActionRouter({
    account, autoConnect, chat, selection, surfaces, panels, features,
    sessions: { reopen: (session, key, signal) => openSession(signal, { cwd: session.cwd, workspace: session.workspace, key }, session.spaceDirectory) },
    showOutput: () => output.show(),
    showError: message => { void vscode.window.showErrorMessage(message) },
    log,
  })
  const addContext = async (text: string, uri?: vscode.Uri) => {
    assertTrusted()
    const selectionIds = uri ? selection.state.matchingIds(uri.toString(), text) : []
    if (uri?.scheme === "file") await chat.assertContextWorkspace(uri.fsPath)
    await surfaces.addContext(text)
    selection.state.consume(selectionIds)
  }
  const review = new EditorReview({ contextKey: () => chat.contextKey(), ready: () => chat.phase() === "ready", checkFile: path => chat.assertContextWorkspace(path), generate: (text, signal, scope) => chat.generateText(text, signal, scope) }, log)
  const nextEdit = new NextEdit({ contextKey: () => chat.contextKey(), completionContext: () => chat.completionContext(), assertContextWorkspace: path => chat.assertContextWorkspace(path), generateText: (prompt, signal, scope) => chat.generateText(prompt, signal, scope) }, log)
  // Chat states reach the editor features created after the chat; listeners run in this order on every publish.
  context.subscriptions.push(nextEdit, chatStates, chatStates.event(state => {
    panels.followChat(state.phase)
    chatLog.phase(state.phase)
    selection.state.setContext(state)
    review.contextChanged()
    nextEdit.contextChanged()
    surfaces.post(state)
  }))
  // Surfaces mount only from here on, so the first Webview message already has its handler.
  surfaces.serve({ dispatch: (action, reply) => router.dispatch(action, reply), publish: () => {
    chat.publish()
    account.publish()
    surfaces.post({ type: "codeSelection", value: selection.state.snapshot() })
  } })
  context.subscriptions.push(output, surfaces, review, registerGitActions(chat, log), registerInlineCompletion(chat, log), registerEditorActions(addContext, (action, document, range, diagnostics) => review.generate(action, document, range, diagnostics)), registerTerminalActions(text => addContext(text)))
  const commands: Record<string, () => unknown> = {
    "codem.open": () => surfaces.focus(),
    "codem.focusChatInput": () => surfaces.focus(),
    "codem.openInTab": () => surfaces.openInTab(),
    "codem.openInSidebar": () => surfaces.openInSidebar(),
    "codem.settings": () => vscode.commands.executeCommand("workbench.action.openSettings", "@ext:codem.codem"),
    "codem.stop": () => chat.stop(),
    "codem.history": async () => { await surfaces.focus(); await chat.toggleHistory() },
    "codem.newChat": async () => { await surfaces.focus(); await chat.newChat(); selection.state.clear() },
    "codem.connect": async () => { await account.initialize(); if (account.signedIn) await chat.connect(); else await surfaces.focus() },
    "codem.account": async () => { if (account.snapshot().status === "checking") await account.initialize(); await surfaces.openAccount() },
    "codem.signIn": async () => {
      if (account.snapshot().status === "checking") await account.initialize()
      if (account.signedIn) await surfaces.openAccount()
      else {
        await surfaces.focus()
        if (account.snapshot().status === "signedOut" || account.snapshot().status === "error") await account.login()
      }
    },
    "codem.showOutput": () => output.show(),
  }
  for (const [name, run] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(name, run))
  context.subscriptions.push({ dispose: () => { panels.cancel(); void account.dispose(); void chat.dispose().catch(() => undefined) } })
  deactivations.add(() => Promise.all([chat.dispose(), account.dispose()]))
}

export async function deactivate(): Promise<void> {
  const pending = [...deactivations]
  deactivations.clear()
  await Promise.all(pending.map(dispose => dispose()))
}
