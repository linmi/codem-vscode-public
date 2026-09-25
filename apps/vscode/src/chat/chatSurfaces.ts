import * as vscode from "vscode"
import { chatHtml } from "./html.ts"
import type { PanelBroker } from "../panels/panelBroker.ts"
import { randomUUID } from "node:crypto"
import type { ComposerDraft, ViewAction } from "../shared/messages.ts"
import { parseViewAction } from "../shared/messages.ts"

type Surface = vscode.WebviewView | vscode.WebviewPanel
/** What a mounted surface asks of the Host. */
export interface SurfaceHandlers {
  /** Handles one parsed action; `reply` answers the surface that sent it. */
  dispatch(action: ViewAction, reply: (value: unknown) => void): Promise<void>
  /** Republishes authoritative state to a surface that became ready or visible again. */
  publish(): void
}
/** One interactive surface and one controller; moving chat never creates a second session. */
export class ChatSurfaces implements vscode.Disposable {
  private sidebar: vscode.WebviewView | undefined
  private editor: vscode.WebviewPanel | undefined
  private active: Surface | undefined
  private ready = false
  private restored = false
  private pendingFocus = false
  private pendingAccount = false
  private readonly restoredWaiters = new Set<(error?: Error) => void>()
  private draft: ComposerDraft | null = null
  private draftRevision = 0
  private contextGeneration = 0
  private pendingSend: { id: string; revision: number } | null = null
  private readonly contexts = new Map<string, { text: string; finish: (accepted: boolean) => void }>()
  private surfaceSubscriptions: vscode.Disposable[] = []
  private readonly subscriptions: vscode.Disposable[] = []
  private handlers: SurfaceHandlers | null = null
  private disposed = false
  /** Created before the features that post to it; nothing mounts until `serve` provides the handlers. */
  constructor(private readonly context: vscode.ExtensionContext, private readonly panels: PanelBroker) {
    this.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("codem.chat.sendKey")) this.postSettings() }))
  }
  /** Registers the sidebar view and editor-tab restore once the handlers exist, so every mounted surface has them. Served once. */
  serve(handlers: SurfaceHandlers): void {
    if (this.handlers) throw new Error("CodeM chat surfaces are already served.")
    this.handlers = handlers
    this.subscriptions.push(vscode.window.registerWebviewViewProvider("codem.chat", { resolveWebviewView: view => {
      this.sidebar = view
      this.subscriptions.push(view.onDidDispose(() => { if (this.active === view) this.detach(view); if (this.sidebar === view) this.sidebar = undefined }))
      if (!this.editor) this.mount(view)
    } }, { webviewOptions: { retainContextWhenHidden: true } }), vscode.window.registerWebviewPanelSerializer("codem.editor", { deserializeWebviewPanel: async panel => { this.attachEditor(panel) } }))
  }
  get available(): boolean { return Boolean(this.active) }
  post(message: unknown): void { if (!this.disposed && this.ready) void this.active?.webview.postMessage(message) }
  resetDraft(): void {
    this.contextGeneration++
    for (const done of this.restoredWaiters) done(new Error("账户已退出，上下文已取消。"))
    for (const pending of this.contexts.values()) pending.finish(false)
    this.contexts.clear()
    this.draft = { draft: "" }; this.draftRevision++; this.pendingSend = null; this.pendingFocus = false
    this.post({ type: "composerDraft", value: this.draft, focus: false, pendingRequestId: null })
  }
  async focus(): Promise<void> {
    this.pendingAccount = false
    this.pendingFocus = true
    if (this.editor) this.editor.reveal(undefined, false)
    else await vscode.commands.executeCommand("codem.chat.focus")
    if (this.ready) { this.post({ type: "focusComposer" }); this.pendingFocus = false }
  }
  async openAccount(): Promise<void> {
    this.pendingFocus = false
    // Reveal without native iframe focus overriding the destination's button focus.
    if (this.editor) this.editor.reveal(undefined, true)
    else if (this.sidebar) this.sidebar.show(true)
    else await vscode.commands.executeCommand("codem.chat.focus")
    this.pendingAccount = true
    this.showPendingAccount()
  }
  private showPendingAccount(): void {
    if (!this.ready || !this.pendingAccount) return
    this.pendingAccount = false; this.pendingFocus = false
    this.post({ type: "showAccount" })
  }
  async addContext(text: string): Promise<void> {
    const generation = this.contextGeneration
    await this.focus()
    if (generation !== this.contextGeneration) throw new Error("账户已退出，上下文已取消。")
    if (!this.restored) await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => { clearTimeout(timer); this.restoredWaiters.delete(done); if (error) reject(error); else resolve() }
      const timer = setTimeout(() => { this.restoredWaiters.delete(done); reject(new Error("聊天界面未就绪，请重新打开后重试。")) }, 10000)
      this.restoredWaiters.add(done)
    })
    if (generation !== this.contextGeneration) throw new Error("账户已退出，上下文已取消。")
    await new Promise<void>((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => { this.contexts.delete(id); reject(new Error("加入上下文未确认，请检查草稿后重试。")) }, 10000)
      this.contexts.set(id, { text, finish: accepted => { clearTimeout(timer); this.contexts.delete(id); if (accepted) resolve(); else reject(new Error("无法加入上下文，草稿可能超过 32000 字符。")) } })
      this.post({ type: "appendContext", id, text })
    })
  }

  openInTab(): void {
    this.pendingFocus = true
    if (this.editor) { this.editor.reveal(undefined, false); return }
    this.attachEditor(vscode.window.createWebviewPanel("codem.editor", "CodeM", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true }))
  }
  async openInSidebar(): Promise<void> {
    this.editor?.dispose()
    await vscode.commands.executeCommand("codem.chat.focus")
    if (this.sidebar && this.active !== this.sidebar) this.mount(this.sidebar)
  }
  private attachEditor(panel: vscode.WebviewPanel): void {
    if (this.editor && this.editor !== panel) { panel.dispose(); return }
    this.editor = panel
    this.subscriptions.push(panel.onDidDispose(() => {
      if (this.editor !== panel) return
      this.editor = undefined
      if (this.active === panel) this.detach(panel)
      if (!this.disposed && this.sidebar) this.mount(this.sidebar)
    }))
    this.mount(panel)
  }
  private detach(owner: Surface): void {
    if (this.active !== owner) return
    for (const subscription of this.surfaceSubscriptions) subscription.dispose()
    this.surfaceSubscriptions = []
    this.active = undefined; this.ready = false; this.restored = false
  }
  private synchronize(): void {
    if (this.disposed || !this.ready || !this.active) return
    this.handlers?.publish(); this.panels.replay(); this.postSettings(); this.showPendingAccount()
  }
  private mount(surface: Surface): void {
    const handlers = this.handlers
    if (this.disposed || !handlers || this.active === surface) return
    const previous = this.active
    if (previous) { this.detach(previous); previous.webview.html = "" }
    this.active = surface; this.ready = false; this.restored = false
    this.panels.transfer(surface, message => this.post(message))
    surface.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist"), vscode.Uri.joinPath(this.context.extensionUri, "assets")] }
    const resource = (path: string) => surface.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, path)).toString()
    // Retain the page while hidden; reveal only republishes authoritative state.
    // Visibility never creates a connection, replaces HTML or restores the draft.
    let visible = surface.visible
    const visibilityChanged = () => {
      const revealed = !visible && surface.visible
      visible = surface.visible
      if (revealed && this.active === surface) this.synchronize()
    }
    this.surfaceSubscriptions.push("onDidChangeVisibility" in surface
      ? surface.onDidChangeVisibility(visibilityChanged)
      : surface.onDidChangeViewState(visibilityChanged))
    this.surfaceSubscriptions.push(surface.webview.onDidReceiveMessage((value: unknown) => {
      if (this.active !== surface) return
      try {
        const action = parseViewAction(value)
        if (action.type === "contextAdded") {
          const pending = this.contexts.get(action.id)
          if (pending) { if (action.accepted) { this.draft = action.value; this.draftRevision++ }; pending.finish(action.accepted) }
          return
        }
        if (action.type === "composerChanged") { this.draft = action.value; this.draftRevision++; return }
        if (action.type === "composerRestore") {
          this.draft ??= action.value
          this.restored = true
          for (const done of this.restoredWaiters) done()
          this.post({ type: "composerDraft", value: this.draft, focus: this.pendingFocus, pendingRequestId: this.pendingSend?.revision === this.draftRevision ? this.pendingSend.id : null })
          for (const [id, pending] of this.contexts) this.post({ type: "appendContext", id, text: pending.text })
          this.pendingFocus = false; return
        }
        if (action.type === "ready") { this.ready = true; this.synchronize() }
        if (action.type === "panelReply") {
          if (vscode.workspace.isTrusted) this.panels.answer(surface, action)
          return
        }
        const submittedRevision = this.draftRevision
        if (action.type === "send") this.pendingSend = { id: action.requestId, revision: submittedRevision }
        void handlers.dispatch(action, result => {
          if (action.type === "send" && (result as { accepted?: boolean }).accepted && this.draft?.draft === action.text && this.draftRevision === submittedRevision) {
            this.draft = { ...this.draft, draft: "" }

          }
          if (action.type === "send") { this.pendingSend = null; this.post(result) }
          else if (this.active === surface) this.post(result)
        }).catch(() => { void vscode.window.showErrorMessage("CodeM 操作未完成，请查看日志并重试。") })
      } catch { void vscode.window.showErrorMessage("CodeM 拒绝了无效界面请求。") }
    }))
    surface.webview.html = chatHtml({ script: resource("dist/webview.js"), style: resource("dist/webview.css"), logo: resource("assets/codemMark.svg"), cspSource: surface.webview.cspSource, surface: surface === this.editor ? "editor" : "sidebar" })
  }
  postSettings(): void { this.post({ type: "editorSettings", sendKey: vscode.workspace.getConfiguration("codem").get<string>("chat.sendKey", "enter") }) }
  dispose(): void {
    this.disposed = true
    for (const done of this.restoredWaiters) done(new Error("聊天界面已关闭。"))
    for (const pending of this.contexts.values()) pending.finish(false)
    if (this.active) this.detach(this.active)
    this.panels.cancel(); this.editor?.dispose()
    for (const item of this.subscriptions) item.dispose()
  }
}
