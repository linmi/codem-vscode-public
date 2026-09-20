import * as vscode from "vscode"
import { NativeChatService } from "./nativeChatService.ts"
import { nativeSessionType, nativeThreadId, type NativeChatApi, type NativeHistoryApi, type NativeSessionController } from "./nativeChatApi.ts"
import { NativeChatPanels } from "./nativeChatPanels.ts"
import { assertTrusted, connectRuntime } from "./runtimeSession.ts"
import { UserVisibleError } from "./chatController.ts"
import { showInteraction } from "./interactions.ts"
import { isBusy, type ChatMessage } from "./messages.ts"

let service: NativeChatService | undefined

async function withCancellation<T>(token: vscode.CancellationToken, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController()
  const subscription = token.onCancellationRequested(() => abort.abort())
  if (token.isCancellationRequested) abort.abort()
  try { return await run(abort.signal) } finally { subscription.dispose() }
}
function markdown(value: string): vscode.MarkdownString {
  const result = new vscode.MarkdownString(value)
  result.isTrusted = false; result.supportHtml = false
  return result
}
function projectHistory(messages: readonly ChatMessage[], api: NativeHistoryApi): (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] {
  const turns: (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] = []
  let response: vscode.ChatResponseMarkdownPart[] = []
  const flush = () => { if (response.length) turns.push(new api.ChatResponseTurn2(response, {}, nativeSessionType)); response = [] }
  for (const message of messages) {
    if (message.role === "user") { flush(); turns.push(new api.ChatRequestTurn(message.text, undefined, [], nativeSessionType, [])) }
    else if (message.role === "assistant") response.push(new vscode.ChatResponseMarkdownPart(markdown(`${message.text}\n\n`)))
    else if (message.role === "tool" || message.role === "reasoning") {
      const text = new vscode.MarkdownString()
      text.appendText(`${message.label} · ${message.status}\n`)
      response.push(new vscode.ChatResponseMarkdownPart(text))
    }
  }
  flush()
  return turns
}

export function activate(context: vscode.ExtensionContext): void {
  if (!vscode.version.startsWith("1.138.")) throw new Error("CodeM 原生实验仅针对 VS Code 1.138.x；请勿在其他版本静默启用。")
  const api = vscode.chat as typeof vscode.chat & NativeChatApi
  const historyApi = vscode as unknown as NativeHistoryApi
  if (typeof api.createChatSessionItemController !== "function" || typeof api.registerChatSessionContentProvider !== "function" || typeof historyApi.ChatResponseTurn2 !== "function") throw new Error("请启用 chatSessionsProvider 提案后启动 CodeM 原生实验。")
  const output = vscode.window.createOutputChannel("CodeM Native Experiment")
  const panels = new NativeChatPanels()
  let items: NativeSessionController | undefined
  const report = (operation: string, error: unknown) => output.appendLine(`${operation}: ${error instanceof UserVisibleError ? error.message : "操作失败，请核对连接和 Core 运行时。"}`)
  const agent = new NativeChatService({
    assertTrusted,
    connect: async (signIn, signal) => {
      const started = performance.now()
      const session = await connectRuntime(context.extensionPath, context.extension.packageJSON.version as string, signIn, signal)
      output.appendLine(`Connection: ${Math.round(performance.now() - started)}ms; one Core connection`)
      return session
    },
    interact: (request, signal, cwd) => showInteraction(request, signal, panels, cwd),
    report,
  }, state => {
    if (!items || !state.threadId) return
    const resource = vscode.Uri.from({ scheme: nativeSessionType, path: `/${state.threadId}` })
    const item = items.items.get(resource)
    if (!item) return
    item.status = isBusy(state.phase) ? 2 : state.notice && state.notice !== "已停止生成。" ? 0 : 1
    item.description = `${state.workspace ?? ""} · ${state.model ?? ""}`
    const title = state.messages.find(message => message.role === "user")?.text.trim().slice(0, 80)
    if (title) item.label = title
    items.items.add(item)
  })
  service = agent
  const refresh = async (token: vscode.CancellationToken) => {
    // Registration/automatic refresh must never trigger authentication or spawn Core.
    if (agent.snapshot().phase !== "ready") return
    const entries = await withCancellation(token, signal => agent.list(signal))
    items!.items.replace(entries.filter(entry => !entry.archived).map(entry => {
      const item = items!.createChatSessionItem(vscode.Uri.from({ scheme: nativeSessionType, path: `/${entry.id}` }), entry.title)
      item.description = `${entry.turnCount} 轮`; item.status = 1
      return item
    }))
  }
  items = api.createChatSessionItemController(nativeSessionType, refresh)
  items.newChatSessionItemHandler = async (input, token) => {
    if (input.request.command) throw new UserVisibleError("原生实验暂不支持斜杠命令，请直接输入任务。")
    const id = await withCancellation(token, signal => agent.create(signal))
    return items!.createChatSessionItem(vscode.Uri.from({ scheme: nativeSessionType, path: `/${id}` }), input.request.prompt.trim().slice(0, 80) || "CodeM 新会话")
  }
  const handlerFor = (resource: vscode.Uri): vscode.ChatRequestHandler => async (request, _chatContext, stream, token) => {
    const started = performance.now()
    try {
      if (request.command || request.references.length || request.toolReferences.length) throw new UserVisibleError("原生实验首版支持纯文本任务；附件、工具引用与斜杠命令请使用 CodeM 独立面板。")
      stream.progress("CodeM 正在准备任务…")
      await withCancellation(token, signal => agent.run(nativeThreadId(resource), request.prompt, { text: value => stream.markdown(markdown(value)), progress: value => stream.progress(value) }, signal))
      return {}
    } catch (error) {
      report("request", error)
      // 1.138's session dispatcher ignores the handler's ChatResult. Throw so the
      // native request is marked failed instead of displaying a successful empty reply.
      throw new UserVisibleError(error instanceof UserVisibleError ? error.message : "CodeM 原生任务未完成，请查看实验日志并从历史核对结果。")
    } finally { output.appendLine(`Request settled: ${Math.round(performance.now() - started)}ms`) }
  }
  const participant = vscode.chat.createChatParticipant(nativeSessionType, async (_request, chatContext, stream, token) => {
    const sessionContext = (chatContext as vscode.ChatContext & { chatSessionContext?: { chatSessionItem: { resource: vscode.Uri } } }).chatSessionContext
    if (!sessionContext) return { errorDetails: { message: "请从会话类型菜单选择 CodeM 后发送任务。" } }
    return handlerFor(sessionContext.chatSessionItem.resource)(_request, chatContext, stream, token)
  })
  participant.iconPath = new vscode.ThemeIcon("sparkle")
  const provider = api.registerChatSessionContentProvider(nativeSessionType, {
    async provideChatSessionContent(resource, token) {
      const draft = resource.scheme === nativeSessionType && resource.path.startsWith("/untitled-")
      const messages = draft ? [] : await withCancellation(token, signal => agent.history(nativeThreadId(resource), signal))
      return { history: projectHistory(messages, historyApi), requestHandler: handlerFor(resource) }
    },
  }, participant, { supportsInterruptions: false })
  const connect = (signIn: boolean) => vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "CodeM 原生实验", cancellable: true }, async (_progress, token) => {
    await withCancellation(token, signal => agent.connect(signIn, signal))
    await refresh(token)
    output.appendLine("Native session provider ready")
  }).then(undefined, error => { report("connect", error); void vscode.window.showErrorMessage(error instanceof UserVisibleError ? error.message : "CodeM 原生连接失败，请查看实验日志。") })
  context.subscriptions.push(output, panels, participant, items, provider,
    vscode.commands.registerCommand("codemNative.connect", () => connect(false)),
    vscode.commands.registerCommand("codemNative.signIn", () => connect(true)),
    vscode.commands.registerCommand("codemNative.showOutput", () => output.show()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void agent.dispose().catch(error => report("workspaceCleanup", error)); void vscode.window.showWarningMessage("工作区目录已变化，请重载窗口后重新连接 CodeM 原生实验。") }),
    { dispose: () => { void agent.dispose().catch(error => report("dispose", error)) } },
  )
}
export async function deactivate(): Promise<void> { await service?.dispose(); service = undefined }
