import { registerTerminalActions } from "./terminalActions.ts"
import { ChatSurfaces } from "./chatSurfaces.ts"
import { registerEditorActions } from "./editorActions.ts"
import { ConnectionPreferences } from "./connectionPreferences.ts"
import * as vscode from "vscode"
import type { SpaceDirectory } from "./spaceDirectory.ts"
import { ChatController, UserVisibleError } from "./chatController.ts"
import { assertTrusted, connectRuntime } from "./runtimeSession.ts"
import { showInteraction } from "./interactions.ts"
import { type ImageResult, type FileSearchResult, type FileSelected, type SendResult, type ViewAction } from "./messages.ts"

import { PanelBroker } from "./panelBroker.ts"
import { selectSettings } from "./settingsPanels.ts"

import { NativeFeatures } from "./nativeFeatures.ts"

let controller: ChatController | undefined

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodeM")
  const preferences = new ConnectionPreferences(context.workspaceState)
  const features = new NativeFeatures(context.secrets)
  context.subscriptions.push(features)
  const panels = new PanelBroker()
  let settingsAbort: AbortController | null = null
  let surfaces: ChatSurfaces | undefined
  let connectingAt: number | null = null
  let previousPhase: string | null = null
  const openSession = async (signIn: boolean, signal: AbortSignal, target = preferences.lastConnection(), directory?: SpaceDirectory) => {
    const runtimeStarted = performance.now()
    const session = await connectRuntime(context.extensionPath, context.extension.packageJSON.version as string, signIn, signal, target, directory)
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
    connected: session => preferences.remember({ cwd: session.cwd, workspace: session.workspace, key: session.space.key }),
    connect: async (signIn, signal) => {
      const session = await openSession(signIn, signal)
      session.host.onEvent((event) => {
        if (event.type === "turn-started") output.appendLine(JSON.stringify({ event: event.type, turnId: event.turnId, submissionId: event.submissionId }))
        if (event.type === "turn-completed") output.appendLine(JSON.stringify({ event: event.type, turnId: event.turnId, outcome: event.outcome, stopReason: event.stopReason }))
      })
      return session
    },
    assertTrusted,
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
    if (autoConnectAttempted || !surfaces?.available || !vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length) return
    if (!vscode.workspace.getConfiguration("codem").get<boolean>("autoConnect", true)) return
    autoConnectAttempted = true
    await chat.connect()
  }
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { void autoConnect() }))
  const dispatch = async (action: ViewAction, reply: (result: SendResult | FileSearchResult | FileSelected | ImageResult) => void): Promise<void> => {
    switch (action.type) {
      case "ready": await autoConnect(); break
      case "composerChanged": case "composerRestore": case "contextAdded": break
      case "panelReply": break
      case "connect": await chat.connect(); break
      case "signIn": await chat.connect(true); break
      case "showHistory": await chat.showHistory(); break
      case "closeHistory": chat.closeHistory(); break
      case "refreshHistory": await chat.refreshHistory(); break
      case "moreThreads": await chat.loadMoreThreads(); break
      case "resumeThread": await chat.resumeThread(action.threadId); break
      case "olderMessages": await chat.loadOlderMessages(); break
      case "reloadHistory": await chat.reloadHistory(); break
      case "newChat": await chat.newChat(); break
      case "send": reply({ type: "sendResult", requestId: action.requestId, accepted: await chat.send(action.text) }); break
      case "stop": await chat.stop(); break
      case "loadCatalog": await chat.loadCatalog(action.kind); break
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
      case "selectSpace": {
        await chat.selectSpace(async (session, signal) => {
          const abort = new AbortController(); settingsAbort = abort
          const cancel = () => abort.abort()
          signal.addEventListener("abort", cancel, { once: true })
          if (signal.aborted) abort.abort()
          try {
            for (;;) {
              const selection = await panels.request<{ kind: "space"; key: string } | { kind: "refresh"; key: string }>({ kind: "space", title: "空间", description: "切换后开始新会话，历史记录仍保留。", choices: [
                ...session.spaceDirectory.list().map(space => ({ label: space.displayName, value: { kind: "space" as const, key: space.projectKey }, selected: space.projectKey === session.space.key })),
                { label: "刷新空间列表", value: { kind: "refresh" as const, key: "" } },
              ] }, abort.signal)
              const choice = selection?.values[0]
              if (!choice) return null
              if (choice.kind === "refresh") {
                let refreshing = true
                void panels.request({ kind: "space", title: "空间", description: "正在刷新空间列表…", choices: [] }, abort.signal).then(() => { if (refreshing) abort.abort() })
                try { await session.spaceDirectory.refresh(abort.signal) }
                catch (error) { if (abort.signal.aborted) return null; throw error }
                finally { refreshing = false; panels.cancel() }
                continue
              }
              if (choice.key === session.space.key) return null
              assertTrusted()
              return await openSession(false, signal, { cwd: session.cwd, workspace: session.workspace, key: choice.key }, session.spaceDirectory)
            }
          } finally {
            signal.removeEventListener("abort", cancel)
            if (settingsAbort === abort) settingsAbort = null
          }
        }); break
      }
      case "selectModel": case "selectEffort": case "selectPermission": case "selectWorkMode": {
        const kind = action.type
        await chat.configure(async (settings, session) => {
          const abort = new AbortController(); settingsAbort = abort
          try { return await selectSettings(kind, settings, session, panels, abort.signal) }
          finally { if (settingsAbort === abort) settingsAbort = null }
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
      case "addAttachment": await chat.addAttachments(() => features.pickAttachments()); break
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
  surfaces = new ChatSurfaces(context, panels, dispatch, () => chat.publish())
  const addContext = async (text: string, uri?: vscode.Uri) => {
    assertTrusted()
    if (uri?.scheme === "file") await chat.assertContextWorkspace(uri.fsPath)
    await surfaces!.addContext(text)
  }
  context.subscriptions.push(output, surfaces, registerEditorActions(addContext), registerTerminalActions(text => addContext(text)), vscode.workspace.onDidChangeConfiguration(event => {
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
    "codem.history": async () => { await surfaces?.focus(); await chat.showHistory() },
    "codem.newChat": async () => { await surfaces?.focus(); await chat.newChat() },
    "codem.connect": () => chat.connect(),
    "codem.signIn": () => chat.connect(true),
    "codem.showOutput": () => output.show(),
  }
  for (const [name, run] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(name, run))
  context.subscriptions.push({ dispose: () => { panels.cancel(); void chat.dispose().catch(() => undefined) } })
}

export async function deactivate(): Promise<void> { await controller?.dispose(); controller = undefined }
