import { AccountController } from "./connection/accountController.ts"
import { accountOperations } from "./connection/runtimeAccount.ts"
import { EditorSelection } from "./integrations/editorSelection.ts"
import { registerGitActions } from "./integrations/gitActions.ts"
import { registerInlineCompletion } from "./integrations/inlineCompletion.ts"
import { registerTerminalActions } from "./integrations/terminalActions.ts"
import { ChatSurfaces } from "./chat/chatSurfaces.ts"
import { registerEditorActions } from "./integrations/editorActions.ts"
import { ConnectionPreferences } from "./connection/connectionPreferences.ts"
import { ActiveConversation } from "./sessionHistory/activeConversation.ts"
import * as vscode from "vscode"
import type { SpaceDirectory } from "./connection/spaceDirectory.ts"
import { ChatController } from "./chat/chatController.ts"
import { UserVisibleError } from "./shared/userVisibleError.ts"
import { assertTrusted, connectRuntime } from "./connection/runtimeSession.ts"
import { showInteraction } from "./panels/interactions.ts"
import { type ImageResult, type FileSearchResult, type FileSelected, type SendResult, type ViewAction } from "./shared/messages.ts"

import { PanelBroker } from "./panels/panelBroker.ts"

import { NativeFeatures } from "./integrations/nativeFeatures.ts"

let controller: ChatController | undefined
let accountController: AccountController | undefined

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodeM")
  const preferences = new ConnectionPreferences(context.workspaceState)
  const features = new NativeFeatures(context.secrets)
  context.subscriptions.push(features)
  const panels = new PanelBroker()
  let settingsAbort: AbortController | null = null
  let surfaces: ChatSurfaces | undefined
  const account = new AccountController(accountOperations(context.extensionPath, (stage, ms) => output.appendLine(`Account ${stage}: ${ms}ms`)), state => {
    void vscode.commands.executeCommand("setContext", "codem.accountStatus", state.status)
    surfaces?.post({ type: "account", state })
  })
  account.publish()
  accountController = account
  let selection: EditorSelection | undefined
  let connectingAt: number | null = null
  let previousPhase: string | null = null
  const openSession = async (signal: AbortSignal, target = preferences.lastConnection(), directory?: SpaceDirectory) => {
    const runtimeStarted = performance.now()
    const session = await connectRuntime(context.extensionPath, context.extension.packageJSON.version as string, signal, target, directory, status => { if (!signal.aborted) account.observe(status) })
    output.appendLine(`Connection runtime: ${Math.round(performance.now() - runtimeStarted)}ms`)
    try {
      const mcpStarted = performance.now()
      session.mcpServers = await features.loadMcp()
      output.appendLine(`Connection MCP settings: ${Math.round(performance.now() - mcpStarted)}ms`)
      return session
    } catch (error) { await session.host.close(); throw error }
  }
  controller = new ChatController({
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
      await surfaces?.focus()
      return showInteraction(request, signal, panels, cwd)
    },
    publish: (state) => {
      if (state.phase !== "configuring") settingsAbort?.abort()
      if (state.phase === "disconnected") panels.cancel()
      if (state.phase !== previousPhase) {
        if (state.phase === "connecting") connectingAt = performance.now()
        else if (connectingAt !== null) {
          output.appendLine(`Connection ${state.phase}: ${Math.round(performance.now() - connectingAt)}ms`)
          connectingAt = null
        }
        output.appendLine(`UI phase: ${state.phase}`); previousPhase = state.phase
      }
      selection?.state.setContext(state)
      surfaces?.post(state)
    },
    report: (operation, error) => {
      // Do not log raw Core frames, broker output, tokens, or arbitrary exception payloads.
      output.appendLine(`${new Date().toISOString()} ${operation}: ${error instanceof UserVisibleError ? error.message : "操作失败；请检查运行时文件、CodeM 登录和网络连接。"}`)
    },
  })
  const chat = controller
  let autoConnectAttempted = false
  const autoConnect = async () => {
    if (!account.signedIn || autoConnectAttempted || !surfaces?.available || !vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length) return
    if (!vscode.workspace.getConfiguration("codem").get<boolean>("autoConnect", true)) return
    autoConnectAttempted = true
    await chat.connect()
  }
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { void autoConnect() }))
  const dispatch = async (action: ViewAction, reply: (result: SendResult | FileSearchResult | FileSelected | ImageResult) => void): Promise<void> => {
    if (!account.signedIn && !["ready", "signIn", "signOut", "cancelSignIn", "refreshAccount", "showOutput"].includes(action.type)) {
      if (action.type === "send") reply({ type: "sendResult", requestId: action.requestId, accepted: false })
      account.publish(); return
    }
    switch (action.type) {
      case "ready": await account.initialize(); account.publish(); await autoConnect(); break
      case "composerChanged": case "composerRestore": case "contextAdded": break
      case "panelReply": break
      case "connect": await account.initialize(); if (account.signedIn) await chat.connect(); else account.publish(); break
      case "signOut": await account.logout(async () => {
        panels.cancel(); settingsAbort?.abort(); selection!.state.clear(); surfaces?.resetDraft()
        autoConnectAttempted = false
        const started = performance.now()
        try { await chat.resetAccount() }
        finally { output.appendLine(`Account disconnect: ${Math.round(performance.now() - started)}ms`) }
      }); break
      case "signIn": await account.login(); break
      case "cancelSignIn": account.cancel(); break
      case "refreshAccount": await account.refresh(); break
      case "showHistory": await chat.showHistory(); break
      case "closeHistory": chat.closeHistory(); break
      case "refreshHistory": await chat.refreshHistory(); break
      case "moreThreads": await chat.loadMoreThreads(); break
      case "resumeThread": await chat.resumeThread(action.threadId); break
      case "olderMessages": await chat.loadOlderMessages(); break
      case "reloadHistory": await chat.reloadHistory(); break
      case "newChat": await chat.newChat(); selection!.state.clear(); break
      case "pinCodeSelection": selection!.state.pin(action.id); break
      case "removeCodeSelection": selection!.state.remove(action.id); break
      case "revealCodeSelection": await selection!.reveal(action.id); break
      case "send": {
        if (!account.signedIn) { account.publish(); reply({ type: "sendResult", requestId: action.requestId, accepted: false }); break }
        let accepted = false
        try { accepted = await selection!.send(action.text, action.selectionIds, text => chat.send(text), path => chat.assertContextWorkspace(path)) }
        catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法附带选中代码，请重新选择后重试。") }
        reply({ type: "sendResult", requestId: action.requestId, accepted }); break
      }
      case "stop": await chat.stop(); break
      case "loadCatalog": await chat.loadCatalog(action.kind); break
      case "loadMoreLiveSnapshot": await chat.loadMoreLiveSnapshot(action.snapshotId, action.kind); break
      case "cancelLiveSnapshot": chat.cancelLiveSnapshot(action.snapshotId); break
      case "selectSkill": chat.selectSkill(action.id); break
      case "steer": if (action.threadId === chat.snapshot().threadId) await chat.steer(action.text, action.requestId); break
      case "askSideQuestion": if (action.threadId === chat.snapshot().threadId) await chat.askSideQuestion(action.text, action.requestId); break
      case "cancelSideQuestion": await chat.cancelSideQuestion(); break
      case "shellCommand": if (action.threadId === chat.snapshot().threadId) await chat.shellCommand(action.text, action.requestId); break
      case "compactThread": if (action.threadId === chat.snapshot().threadId) await chat.startControl("compact", action.requestId); break
      case "rewindThread": if (action.threadId === chat.snapshot().threadId) await chat.startControl("rewind", action.requestId); break
      case "clearThread": if (action.threadId === chat.snapshot().threadId) await chat.manageThread("clear", action.threadId, "", action.requestId); break
      case "manageThread": await chat.manageThread(action.operation, action.threadId, action.name, action.requestId); break
      case "addDirectory": await chat.addDirectory(() => features.pickDirectories()); break
      case "removeDirectory": await chat.removeDirectory(action.id); break
      case "chooseModel": await chat.chooseModel(action.id); break
      case "chooseSpace": await chat.chooseSpace(action.id, (session, key, signal) => openSession(signal, { cwd: session.cwd, workspace: session.workspace, key }, session.spaceDirectory)); break
      case "refreshSpaces": await chat.refreshSpaces(); break
      case "setEffort": case "setWorkMode": case "setPermission": {
        await chat.setComposerSetting(action, async signal => {
          const abort = new AbortController(); settingsAbort = abort
          const cancel = () => abort.abort()
          signal.addEventListener("abort", cancel, { once: true })
          if (signal.aborted) cancel()
          try {
            const answer = await panels.request({ kind: "approval", title: "启用完全访问？", description: "任务将跳过工具权限审批执行操作。仅对你信任的任务启用。", choices: [{ value: false, label: "保持当前权限" }, { value: true, label: "启用完全访问" }] }, abort.signal)
            return answer?.values[0] === true
          } finally { signal.removeEventListener("abort", cancel); if (settingsAbort === abort) settingsAbort = null }
        }); break
      }
      case "manageMcp": await chat.configure(settings => features.selectMcp(settings)); break
      case "searchFiles": {
        try { reply({ type: "fileSearchResult", requestId: action.requestId, files: await chat.searchFiles(action.query, (cwd, query) => features.findFiles(cwd, query)), error: null }) }
        catch { reply({ type: "fileSearchResult", requestId: action.requestId, files: [], error: "文件搜索失败，请重试。" }) }
        break
      }
      case "selectFile": {
        try { reply({ type: "fileSelected", requestId: action.requestId, accepted: await chat.selectFile(action.id) }) }
        catch { reply({ type: "fileSelected", requestId: action.requestId, accepted: false }) }
        break
      }
      case "pickAttachment": await chat.addAttachments(() => features.pickAttachments(action.kind)); break
      case "openArtifact": await chat.openArtifact(action.id, source => features.showArtifact(source)); break
      case "loadImage": reply({ type: "imageResult", id: action.id, preview: await chat.loadImage(action.id) }); break
      case "removeAttachment": chat.removeAttachment(action.id); break
      case "openDiff": await chat.showDiff(action.id, (diff, cwd) => features.showDiff(diff, cwd)); break
      case "openChangedFile": await chat.showDiff(action.id, (diff, cwd) => features.showChangedFile(diff, cwd)); break
      case "refreshTools": await chat.refreshTools(); break
      case "refreshBackground": await chat.refreshBackground(); break
      case "cleanBackground": await chat.cleanBackground(); break
      case "terminateBackground": await chat.terminateBackground(action.id); break
      case "cancelBackgroundTask": await chat.cancelTask(action.id); break
      case "openBackgroundLog": await chat.showBackgroundLog(action.id, (path) => features.showLog(path)); break
      case "showOutput": output.show(); break
    }
  }
  selection = new EditorSelection(value => surfaces?.post({ type: "codeSelection", value }))
  context.subscriptions.push(selection)
  surfaces = new ChatSurfaces(context, panels, dispatch, () => {
    chat.publish()
    account.publish()
    surfaces?.post({ type: "codeSelection", value: selection!.state.snapshot() })
  })
  const addContext = async (text: string, uri?: vscode.Uri) => {
    assertTrusted()
    const selectionIds = uri ? selection!.state.matchingIds(uri.toString(), text) : []
    if (uri?.scheme === "file") await chat.assertContextWorkspace(uri.fsPath)
    await surfaces!.addContext(text)
    selection!.state.consume(selectionIds)
  }
  context.subscriptions.push(output, surfaces, registerGitActions(chat, message => output.appendLine(message)), registerInlineCompletion(chat, message => output.appendLine(message)), registerEditorActions(addContext), registerTerminalActions(text => addContext(text)), vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration("codem.chat.sendKey")) surfaces?.postSettings()
    if (event.affectsConfiguration("codem.autoConnect")) void autoConnect()
  }))
  const commands: Record<string, () => unknown> = {
    "codem.open": () => surfaces?.focus(),
    "codem.focusChatInput": () => surfaces?.focus(),
    "codem.openInTab": () => surfaces?.openInTab(),
    "codem.openInSidebar": () => surfaces?.openInSidebar(),
    "codem.settings": () => vscode.commands.executeCommand("workbench.action.openSettings", "@ext:codem.codem"),
    "codem.stop": () => chat.stop(),
    "codem.history": async () => { await surfaces?.focus(); await chat.toggleHistory() },
    "codem.newChat": async () => { await surfaces?.focus(); await chat.newChat(); selection!.state.clear() },
    "codem.connect": async () => { await account.initialize(); if (account.signedIn) await chat.connect(); else await surfaces?.focus() },
    "codem.account": async () => { if (account.snapshot().status === "checking") await account.initialize(); await surfaces?.openAccount() },
    "codem.signIn": async () => {
      if (account.snapshot().status === "checking") await account.initialize()
      if (account.signedIn) await surfaces?.openAccount()
      else {
        await surfaces?.focus()
        if (account.snapshot().status === "signedOut" || account.snapshot().status === "error") await account.login()
      }
    },
    "codem.showOutput": () => output.show(),
  }
  for (const [name, run] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(name, run))
  context.subscriptions.push({ dispose: () => { panels.cancel(); void account.dispose(); void chat.dispose().catch(() => undefined) } })
}

export async function deactivate(): Promise<void> { await Promise.all([controller?.dispose(), accountController?.dispose()]); controller = undefined; accountController = undefined }
