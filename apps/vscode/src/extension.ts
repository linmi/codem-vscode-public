import * as vscode from "vscode"
import { ChatController, UserVisibleError } from "./chatController.ts"
import { assertTrusted, connectRuntime } from "./runtimeSession.ts"
import { showInteraction } from "./interactions.ts"
import { parseViewAction, type ImageResult, type FileSearchResult, type FileSelected, type SendResult, type ViewAction } from "./messages.ts"
import { chatHtml } from "./html.ts"

import { PanelBroker } from "./panelBroker.ts"
import { selectSettings } from "./settingsPanels.ts"

import { NativeFeatures } from "./nativeFeatures.ts"

let controller: ChatController | undefined

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("CodeM")
  const features = new NativeFeatures(context.secrets)
  context.subscriptions.push(features)
  const panels = new PanelBroker()
  let settingsAbort: AbortController | null = null
  let view: vscode.WebviewView | undefined
  let previousPhase: string | null = null
  controller = new ChatController({
    connect: async (signIn, signal) => {
      const session = await connectRuntime(context.extensionPath, context.extension.packageJSON.version as string, signIn, signal)
      session.host.onEvent((event) => {
        if (event.type === "turn-started") output.appendLine(JSON.stringify({ event: event.type, turnId: event.turnId, submissionId: event.submissionId }))
        if (event.type === "turn-completed") output.appendLine(JSON.stringify({ event: event.type, turnId: event.turnId, outcome: event.outcome, stopReason: event.stopReason }))
      })
      return session
    },
    assertTrusted,
    interact: async (request, signal, cwd) => {
      await vscode.commands.executeCommand("codem.chat.focus")
      return showInteraction(request, signal, panels, cwd)
    },
    publish: (state) => {
      if (state.phase !== "configuring") settingsAbort?.abort()
      if (state.phase === "disconnected") panels.cancel()
      if (state.phase !== previousPhase) { output.appendLine(`UI phase: ${state.phase}`); previousPhase = state.phase }
      void view?.webview.postMessage(state)
    },
    report: (operation, error) => {
      // Do not log raw Core frames, broker output, tokens, or arbitrary exception payloads.
      output.appendLine(`${new Date().toISOString()} ${operation}: ${error instanceof UserVisibleError ? error.message : "操作失败；请检查运行时文件、CodeM 登录和网络连接。"}`)
    },
  })
  const chat = controller
  const dispatch = async (action: ViewAction, reply: (result: SendResult | FileSearchResult | FileSelected | ImageResult) => void): Promise<void> => {
    switch (action.type) {
      case "ready": chat.publish(); panels.replay(); break
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
  context.subscriptions.push(output, vscode.window.registerWebviewViewProvider("codem.chat", {
    resolveWebviewView(resolved) {
      view = resolved
      panels.bind(resolved, message => { void resolved.webview.postMessage(message) })
      resolved.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist"), vscode.Uri.joinPath(context.extensionUri, "assets")],
      }
      const resource = (path: string) => resolved.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, path)).toString()
      resolved.webview.html = chatHtml({ script: resource("dist/webview.js"), style: resource("dist/webview.css"), logo: resource("assets/codemMark.svg"), cspSource: resolved.webview.cspSource })
      const listener = resolved.webview.onDidReceiveMessage((message: unknown) => {
        if (view !== resolved) return
        try {
          const action = parseViewAction(message)
          if (action.type === "panelReply") { assertTrusted(); panels.answer(resolved, action); return }
          void dispatch(action, (result) => { void resolved.webview.postMessage(result) }).catch(() => { output.appendLine("CodeM 操作未完成，请重试。"); void vscode.window.showErrorMessage("CodeM 操作未完成，文件可能已移除或不在当前工作区。") }) }
        catch { output.appendLine("拒绝了不受支持的界面请求。") }
      })
      resolved.onDidDispose(() => { listener.dispose(); panels.unbind(resolved); if (view === resolved) view = undefined })
    },
  }))
  const commands: Record<string, () => unknown> = {
    "codem.open": () => vscode.commands.executeCommand("codem.chat.focus"),
    "codem.history": async () => { await vscode.commands.executeCommand("codem.chat.focus"); await chat.showHistory() },
    "codem.newChat": async () => { await vscode.commands.executeCommand("codem.chat.focus"); await chat.newChat() },
    "codem.connect": () => chat.connect(),
    "codem.signIn": () => chat.connect(true),
    "codem.showOutput": () => output.show(),
  }
  for (const [name, run] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(name, run))
  context.subscriptions.push({ dispose: () => { panels.cancel(); void chat.dispose().catch(() => undefined) } })
}

export async function deactivate(): Promise<void> { await controller?.dispose(); controller = undefined }
