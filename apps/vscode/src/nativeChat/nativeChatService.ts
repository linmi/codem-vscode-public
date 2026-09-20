import { ChatController, type ChatControllerOptions } from "../chat/chatController.ts"
import { UserVisibleError } from "../shared/userVisibleError.ts"
import { isBusy, type ChatMessage, type ChatSnapshot } from "../shared/messages.ts"
import type { HistoryEntry } from "../shared/historyTypes.ts"

export interface NativeChatOutput {
  text(value: string): void
  progress(value: string): void
}

/** Append-only native streams must not replay a full snapshot for every token. */
export class NativeChatProjection {
  private readonly texts = new Map<string, string>()
  private readonly activities = new Map<string, string>()
  private lastTextId: string | null = null
  private readonly baseline: Set<string>
  private readonly output: NativeChatOutput
  constructor(messages: readonly ChatMessage[], output: NativeChatOutput) {
    this.output = output
    this.baseline = new Set(messages.map(message => message.id))
  }
  update(state: ChatSnapshot): void {
    for (const message of state.messages) {
      if (this.baseline.has(message.id) || message.role === "user") continue
      if (message.role === "assistant") {
        const previous = this.texts.get(message.id) ?? ""
        if (previous === message.text) continue
        const append = message.text.startsWith(previous)
        if (this.lastTextId !== message.id || !append) this.output.text(!append ? "\n\n（Core 更新了这段回复）\n\n" : this.lastTextId ? "\n\n" : "")
        this.output.text(append ? message.text.slice(previous.length) : message.text)
        this.texts.set(message.id, message.text)
        this.lastTextId = message.id
      } else if (message.role === "tool" || message.role === "reasoning") {
        const status = `${message.label} · ${message.status}`
        if (this.activities.get(message.id) === status) continue
        this.activities.set(message.id, status)
        this.output.progress(message.role === "reasoning" ? `思考 · ${message.status}` : status)
      }
    }
  }
}

/** One foreground native session at a time; all Agent semantics remain in ChatController/Core. */
export class NativeChatService {
  private controller: ChatController
  private busy = false
  private disposed = false
  private shutdown: Promise<void> | null = null
  private observer: ((state: ChatSnapshot) => void) | null = null
  private cancelRun: (() => void) | null = null
  private readonly options: Omit<ChatControllerOptions, "publish">
  private readonly changed: (state: ChatSnapshot) => void
  private readonly cancellationTimeoutMs: number

  constructor(options: Omit<ChatControllerOptions, "publish">, changed: (state: ChatSnapshot) => void, cancellationTimeoutMs = 5000) {
    this.options = options; this.changed = changed; this.cancellationTimeoutMs = cancellationTimeoutMs
    this.controller = this.makeController()
  }
  private makeController(): ChatController {
    const controller = new ChatController({ ...this.options, publish: state => {
      if (this.disposed || this.controller !== controller) return
      this.changed(state)
      this.observer?.(state)
    } })
    return controller
  }
  snapshot(): ChatSnapshot { return this.controller.snapshot() }
  private async exclusive<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    if (this.disposed) throw new UserVisibleError("原生 CodeM 已关闭。")
    if (this.busy || isBusy(this.snapshot().phase)) throw new UserVisibleError("CodeM 正在处理任务，请先停止或等待完成，再切换会话。")
    this.busy = true
    try { return await run() } finally { this.busy = false }
  }
  private async ensureConnected(signIn: boolean, signal: AbortSignal): Promise<void> {
    if (this.snapshot().phase === "disconnected") {
      const controller = this.controller
      // Cancel startup by disposing its lifetime; never leave a late Core process attached.
      let closing: Promise<void> | undefined
      const cancel = () => { closing ??= controller.dispose(); void closing.catch(error => this.options.report("nativeConnectCleanup", error)) }
      signal.addEventListener("abort", cancel, { once: true })
      try { await controller.connect(signIn) }
      finally {
        signal.removeEventListener("abort", cancel)
        await closing
        if (signal.aborted && !this.disposed && this.controller === controller) this.controller = this.makeController()
      }
    }
    signal.throwIfAborted()
    if (this.snapshot().phase !== "ready") throw new UserVisibleError(this.snapshot().notice ?? "请先连接原生 CodeM。")
  }
  connect(signIn: boolean, signal: AbortSignal): Promise<void> {
    return this.exclusive(signal, () => this.ensureConnected(signIn, signal))
  }
  create(signal: AbortSignal): Promise<string> {
    return this.exclusive(signal, async () => {
      await this.ensureConnected(false, signal)
      await this.controller.newChat()
      signal.throwIfAborted()
      return this.controller.createThread()
    })
  }
  list(signal: AbortSignal): Promise<readonly HistoryEntry[]> {
    return this.exclusive(signal, async () => {
      await this.ensureConnected(false, signal)
      await this.controller.showHistory()
      for (;;) {
        signal.throwIfAborted()
        const history = this.snapshot().history
        if (history.error) throw new UserVisibleError(history.error)
        if (!history.hasMore) return history.entries
        await this.controller.loadMoreThreads()
      }
    })
  }
  private async select(threadId: string, signal: AbortSignal): Promise<void> {
    await this.ensureConnected(false, signal)
    if (this.snapshot().threadId === threadId) return
    await this.controller.showHistory()
    while (!this.snapshot().history.entries.some(entry => entry.id === threadId) && this.snapshot().history.hasMore) {
      signal.throwIfAborted()
      if (this.snapshot().history.error) throw new UserVisibleError(this.snapshot().history.error!)
      await this.controller.loadMoreThreads()
    }
    signal.throwIfAborted()
    if (this.snapshot().history.error) throw new UserVisibleError(this.snapshot().history.error!)
    await this.controller.resumeThread(threadId)
    if (this.snapshot().threadId !== threadId || this.snapshot().notice) throw new UserVisibleError(this.snapshot().notice ?? "无法恢复所选 CodeM 会话。")
  }
  history(threadId: string, signal: AbortSignal): Promise<readonly ChatMessage[]> {
    return this.exclusive(signal, async () => {
      await this.select(threadId, signal)
      while (this.snapshot().hasOlderMessages) {
        signal.throwIfAborted()
        await this.controller.loadOlderMessages()
        if (this.snapshot().notice) throw new UserVisibleError(this.snapshot().notice!)
      }
      signal.throwIfAborted()
      return this.snapshot().messages
    })
  }
  run(threadId: string, prompt: string, output: NativeChatOutput, signal: AbortSignal): Promise<void> {
    return this.exclusive(signal, async () => {
      if (!prompt.trim() || prompt.length > 32_000) throw new UserVisibleError("任务内容为空或超过 32000 字符。")
      await this.select(threadId, signal)
      signal.throwIfAborted()
      const controller = this.controller
      const projection = new NativeChatProjection(controller.snapshot().messages, output)
      let interruptRequested = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      let began = false
      let finish!: (error?: Error) => void
      const terminal = new Promise<void>((resolve, reject) => {
        finish = error => {
          if (settled) return
          settled = true
          if (error) reject(error); else resolve()
        }
      })
      // Register a rejection consumer before starting RPC; terminal can arrive before its reply.
      void terminal.catch(() => undefined)
      const interrupt = () => {
        if (settled || interruptRequested || controller.snapshot().phase !== "running") return
        interruptRequested = true
        void controller.stop().catch(error => finish(error))
      }
      const cancel = () => {
        if (settled || timer) return
        interrupt()
        timer = setTimeout(() => {
          finish(new UserVisibleError("停止后未收到 Core 终态，实验连接已关闭；请从历史核对结果。"))
        }, this.cancellationTimeoutMs)
      }
      this.cancelRun = () => finish(new UserVisibleError("原生 CodeM 连接已关闭。"))
      this.observer = state => {
        if (settled) return
        try {
          projection.update(state)
          if (state.phase === "sending" || state.phase === "running" || state.phase === "stopping") began = true
          if (signal.aborted) interrupt()
          if (state.phase === "disconnected") finish(new UserVisibleError(state.notice ?? "Core 已断开连接。"))
          else if (began && state.phase === "ready") finish(state.notice && state.notice !== "已停止生成。" ? new UserVisibleError(state.notice) : undefined)
        } catch (error) { finish(error instanceof Error ? error : new Error("原生回复显示失败。")); cancel() }
      }
      signal.addEventListener("abort", cancel, { once: true })
      try {
        void controller.send(prompt).then(accepted => {
          if (!accepted) finish(new UserVisibleError(controller.snapshot().notice ?? "Core 未确认任务，未自动重发。"))
        }, error => finish(error instanceof Error ? error : new Error("发送失败。")))
        if (signal.aborted) cancel()
        await terminal
      } finally {
        clearTimeout(timer)
        signal.removeEventListener("abort", cancel)
        this.observer = null; this.cancelRun = null
        if (isBusy(controller.snapshot().phase)) {
          await controller.dispose()
          if (!this.disposed && this.controller === controller) this.controller = this.makeController()
        }
      }
    })
  }
  dispose(): Promise<void> {
    if (this.shutdown) return this.shutdown
    this.disposed = true
    this.cancelRun?.()
    this.observer = null
    this.shutdown = this.controller.dispose()
    return this.shutdown
  }
}
