import * as vscode from "vscode"
import { chatHtml } from "./html.ts"
import type { PanelBroker } from "./panelBroker.ts"
import { randomUUID } from "node:crypto"
import type { ComposerDraft, ViewAction } from "./messages.ts"
import { parseViewAction } from "./messages.ts"

type Surface = vscode.WebviewView | vscode.WebviewPanel
/** One interactive surface and one controller; moving chat never creates a second session. */
export class ChatSurfaces implements vscode.Disposable {
  private sidebar: vscode.WebviewView | undefined
  private editor: vscode.WebviewPanel | undefined
  private active: Surface | undefined
  private ready = false
  private restored = false
  private pendingFocus = false
  private readonly restoredWaiters = new Set<(error?: Error) => void>()
  private draft: ComposerDraft | null = null
  private draftRevision = 0
  private pendingSend: { id: string; revision: number } | null = null
  private readonly contexts = new Map<string, { text: string; finish: (accepted: boolean) => void }>()
  private listener: vscode.Disposable | undefined
  private readonly subscriptions: vscode.Disposable[] = []
  private disposed = false
  constructor(private readonly context: vscode.ExtensionContext, private readonly panels: PanelBroker, private readonly dispatch: (action: ViewAction, reply: (value: unknown) => void) => Promise<void>, private readonly publish: () => void) {
    this.subscriptions.push(vscode.window.registerWebviewViewProvider("codem.chat", { resolveWebviewView: view => {
      this.sidebar = view
      this.subscriptions.push(view.onDidDispose(() => { if (this.active === view) this.detach(view); if (this.sidebar === view) this.sidebar = undefined }))
      if (!this.editor) this.mount(view)
    } }), vscode.window.registerWebviewPanelSerializer("codem.editor", { deserializeWebviewPanel: async panel => { this.attachEditor(panel) } }))
  }
  get available(): boolean { return Boolean(this.active) }
  post(message: unknown): void { if (this.ready) void this.active?.webview.postMessage(message) }
  async focus(): Promise<void> {
    this.pendingFocus = true
    if (this.editor) this.editor.reveal(undefined, false)
    else await vscode.commands.executeCommand("codem.chat.focus")
    if (this.ready) { this.post({ type: "focusComposer" }); this.pendingFocus = false }
  }
  async addContext(text: string): Promise<void> {
    await this.focus()
    if (!this.restored) await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => { clearTimeout(timer); this.restoredWaiters.delete(done); if (error) reject(error); else resolve() }
      const timer = setTimeout(() => { this.restoredWaiters.delete(done); reject(new Error("聊天界面未就绪，请重新打开后重试。")) }, 10000)
      this.restoredWaiters.add(done)
    })
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
    this.attachEditor(vscode.window.createWebviewPanel("codem.editor", "CodeM", vscode.ViewColumn.Active, { enableScripts: true }))
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
    this.listener?.dispose(); this.listener = undefined
    if (this.active === owner) { this.active = undefined; this.ready = false }
  }
  private mount(surface: Surface): void {
    const previous = this.active
    if (previous) { this.detach(previous); previous.webview.html = "" }
    this.active = surface; this.ready = false; this.restored = false
    this.panels.transfer(surface, message => this.post(message))
    surface.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist"), vscode.Uri.joinPath(this.context.extensionUri, "assets")] }
    const resource = (path: string) => surface.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, path)).toString()
    this.listener = surface.webview.onDidReceiveMessage((value: unknown) => {
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
        if (action.type === "ready") { this.ready = true; this.publish(); this.panels.replay(); this.postSettings() }
        if (action.type === "panelReply") {
          if (vscode.workspace.isTrusted) this.panels.answer(surface, action)
          return
        }
        const submittedRevision = this.draftRevision
        if (action.type === "send") this.pendingSend = { id: action.requestId, revision: submittedRevision }
        void this.dispatch(action, result => {
          if (action.type === "send" && (result as { accepted?: boolean }).accepted && this.draft?.draft === action.text && this.draftRevision === submittedRevision) {
            this.draft = { ...this.draft, draft: "" }

          }
          if (action.type === "send") { this.pendingSend = null; this.post(result) }
          else if (this.active === surface) this.post(result)
        }).catch(() => { void vscode.window.showErrorMessage("CodeM 操作未完成，请查看日志并重试。") })
      } catch { void vscode.window.showErrorMessage("CodeM 拒绝了无效界面请求。") }
    })
    surface.webview.html = chatHtml({ script: resource("dist/webview.js"), style: resource("dist/webview.css"), logo: resource("assets/codemMark.svg"), cspSource: surface.webview.cspSource })
  }
  postSettings(): void { this.post({ type: "editorSettings", sendKey: vscode.workspace.getConfiguration("codem").get<string>("chat.sendKey", "enter") }) }
  dispose(): void {
    this.disposed = true
    for (const done of this.restoredWaiters) done(new Error("聊天界面已关闭。"))
    for (const pending of this.contexts.values()) pending.finish(false)
    this.listener?.dispose(); this.panels.cancel(); this.editor?.dispose()
    for (const item of this.subscriptions) item.dispose()
  }
}
