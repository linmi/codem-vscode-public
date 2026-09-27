import * as vscode from "vscode"
import { createBundledAppServerRuntimeResolver } from "@codem/app-server"
import { ChatController } from "./chat/chatController.ts"
import { ChatLog } from "./chat/chatLog.ts"
import { ChatSurfaces } from "./chat/chatSurfaces.ts"
import { registerChatCommands } from "./chat/chatCommands.ts"
import { ViewActionRouter } from "./chat/viewActionRouter.ts"
import { AccountController } from "./connection/accountController.ts"
import { AutoConnect } from "./connection/autoConnect.ts"
import { ConnectionPreferences } from "./connection/connectionPreferences.ts"
import { accountOperations } from "./connection/runtimeAccount.ts"
import { assertTrusted } from "./connection/runtimeSession.ts"
import { SessionOpener } from "./connection/sessionOpener.ts"
import { registerEditorActions } from "./integrations/editorActions.ts"
import { EditorReview } from "./integrations/editorReview.ts"
import { EditorSelection } from "./integrations/editorSelection.ts"
import { registerGitActions } from "./integrations/gitActions.ts"
import { registerKeepAwake } from "./integrations/keepAwakeActions.ts"
import { registerInlineCompletion } from "./integrations/inlineCompletion.ts"
import { NativeFeatures } from "./integrations/nativeFeatures.ts"
import { NextEdit } from "./integrations/nextEdit/nextEdit.ts"
import { registerTerminalActions } from "./integrations/terminalActions.ts"
import { registerWorktreeActions } from "./integrations/worktreeActions.ts"
import { registerTerminalGeneration } from "./integrations/terminalGeneration.ts"
import { showInteraction } from "./panels/interactions.ts"
import { PanelBroker } from "./panels/panelBroker.ts"
import { ActiveConversation } from "./sessionHistory/activeConversation.ts"
import type { ChatSnapshot } from "./shared/messages.ts"

/** The only module state: each activation's asynchronous disposal, which deactivate awaits. VS Code does not await `context.subscriptions`. */
const deactivations = new Set<() => Promise<unknown>>()

/** Creates each owner in dependency order and connects them through narrow capabilities. Decisions belong to the owners. */
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
  const panels = new PanelBroker()
  // Created first so every feature below can post to it; it mounts nothing until `serve`.
  const surfaces = new ChatSurfaces(context, panels)
  const account = new AccountController(accountOperations(runtime, (stage, ms) => log(`Account ${stage}: ${ms}ms`)), state => {
    void vscode.commands.executeCommand("setContext", "codem.accountStatus", state.status)
    surfaces.post({ type: "account", state })
  })
  account.publish()
  const sessions = new SessionOpener({ runtime, version: context.extension.packageJSON.version as string, preferences, loadMcp: () => features.loadMcp(), observeAuth: status => account.observe(status), log })
  const chatLog = new ChatLog(log)
  // The one late edge: editor review and Next Edit call the chat, so they subscribe to its states after it exists.
  const chatStates = new vscode.EventEmitter<ChatSnapshot>()
  const chat = new ChatController({
    preferences,
    authenticationInvalidated: () => account.invalidate(),
    activeConversation: new ActiveConversation(context.workspaceState),
    connected: session => sessions.remember(session),
    connect: signal => sessions.connect(signal),
    assertTrusted: () => { assertTrusted(); account.assertSignedIn() },
    interact: async (request, signal, cwd) => { await surfaces.focus(); return showInteraction(request, signal, panels, cwd) },
    requestApproval: (question, signal) => panels.request(question, signal),
    publish: state => chatStates.fire(state),
    report: (operation, error) => chatLog.report(operation, error),
  })
  const autoConnect = new AutoConnect({ signedIn: () => account.signedIn, surfaceAvailable: () => surfaces.available, connect: () => chat.connect() })
  const selection = new EditorSelection(value => surfaces.post({ type: "codeSelection", value }))
  const review = new EditorReview({ contextKey: () => chat.contextKey(), ready: () => chat.phase() === "ready", checkFile: path => chat.assertContextWorkspace(path), generate: (text, signal, scope) => chat.generateText(text, signal, scope) }, log)
  const nextEdit = new NextEdit({ contextKey: () => chat.contextKey(), completionContext: () => chat.completionContext(), assertContextWorkspace: path => chat.assertContextWorkspace(path), generateText: (prompt, signal, scope) => chat.generateText(prompt, signal, scope) }, log)
  const router = new ViewActionRouter({
    account, autoConnect, chat, selection, surfaces, panels, features, sessions, log,
    showOutput: () => output.show(),
    showError: message => { void vscode.window.showErrorMessage(message) },
  })
  const addContext = (text: string, uri?: vscode.Uri) => selection.addContext(text, uri, value => surfaces.addContext(value), path => chat.assertContextWorkspace(path))
  context.subscriptions.push(features, autoConnect, selection, nextEdit, chatStates, chatStates.event(state => {
    // Each owner decides how it follows the chat; this is the order the chat has always published in.
    panels.followChat(state.phase)
    chatLog.phase(state.phase)
    selection.state.setContext(state)
    review.contextChanged()
    nextEdit.contextChanged()
    surfaces.post(state)
  }))
  surfaces.serve({ dispatch: (action, reply) => router.dispatch(action, reply), publish: () => {
    chat.publish()
    account.publish()
    surfaces.post({ type: "codeSelection", value: selection.state.snapshot() })
  } })
  context.subscriptions.push(
    output, surfaces, review,
    registerGitActions(chat, log),
    registerInlineCompletion(chat, log),
    registerEditorActions(addContext, (action, document, range, diagnostics) => review.generate(action, document, range, diagnostics)),
    registerTerminalActions(text => addContext(text)),
    registerKeepAwake(log),
    registerWorktreeActions(log),
    registerTerminalGeneration(chat, log),
    registerChatCommands({ surfaces, chat, account, selection: selection.state, showOutput: () => output.show() }),
    { dispose: () => { panels.cancel(); void account.dispose(); void chat.dispose().catch(() => undefined) } },
  )
  deactivations.add(() => Promise.all([chat.dispose(), account.dispose()]))
}

export async function deactivate(): Promise<void> {
  const pending = [...deactivations]
  deactivations.clear()
  await Promise.all(pending.map(dispose => dispose()))
}
