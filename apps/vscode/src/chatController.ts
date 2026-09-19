import { randomUUID } from "node:crypto"
import { APP_SERVER_BUILTIN_INTELLIGENCE_TIERS, type AppServerThreadSettings, type AppServerModelSummary, type AppServerPromptAttachment, type AppServerFileDiff, type AppServerBackgroundTerminal, DEFAULT_APP_SERVER_THREAD_SETTINGS, type AppServerHost, type AppServerHostEvent, type AppServerInteraction, type AppServerInteractionResponse } from "@codem/app-server"
import { initialSnapshot, isBusy, type ChatMessage, type ChatSnapshot } from "./messages.ts"

import { HistoryListController } from "./historyList.ts"
import { historyMessages } from "./historyMessages.ts"
import type { SessionHistoryReader } from "./sessionHistory.ts"

import { displayPath, validateAttachment } from "./filePresentation.ts"

export type ChatHost = Pick<AppServerHost, "listThreads" | "readThread" | "resumeThread" | "readModes" | "setModes" | "listTools" | "listBackgroundTerminals" | "terminateBackgroundTerminal" | "cleanBackgroundTerminals" | "cancelBackgroundTask" | "onEvent" | "startThread" | "startTurn" | "interruptTurn" | "unsubscribeThread" | "respondToInteraction" | "close">
export interface ChatSession {
  host: ChatHost
  cwd: string
  workspace: string
  model: string
  models: readonly AppServerModelSummary[]
  mcpServers: AppServerThreadSettings["mcpServers"]
  authorize: () => Promise<void>
  readHistory: SessionHistoryReader
}
interface ActiveTurn {
  submissionId: string
  turnId: string | null
  abort: AbortController
  requests: Map<string, AbortController>
  approvals: Promise<void>
}
export class UserVisibleError extends Error {}
export interface ChatControllerOptions {
  connect: (signIn: boolean, signal: AbortSignal) => Promise<ChatSession>
  assertTrusted: () => void
  publish: (state: ChatSnapshot) => void
  interact: (request: AppServerInteraction, signal: AbortSignal) => Promise<AppServerInteractionResponse | null>
  report: (operation: string, error: unknown) => void
}

/** One live conversation. Core owns durable history; these are display-only snapshots. */
export class ChatController {
  private readonly options: ChatControllerOptions
  private session: ChatSession | null = null
  private threadId: string | null = null
  private active: ActiveTurn | null = null
  private unsubscribe: (() => void) | null = null
  private generation = 0
  private disposed = false
  private readonly lifetime = new AbortController()
  private state: ChatSnapshot = initialSnapshot()
  private settings: AppServerThreadSettings = { ...DEFAULT_APP_SERVER_THREAD_SETTINGS, permissionMode: "default" }
  private readonly attachments = new Map<string, AppServerPromptAttachment>()
  private readonly diffs = new Map<string, AppServerFileDiff>()
  private readonly terminals = new Map<string, AppServerBackgroundTerminal>()
  private readonly tasks = new Map<string, string>()
  private poll: ReturnType<typeof setInterval> | null = null

  private readonly historyList: HistoryListController
  private historyCursor: string | null = null
  private historyRead: AbortController | null = null
  private restoringThreadId: string | null = null

  constructor(options: ChatControllerOptions) {
    this.options = options
    this.historyList = new HistoryListController(() => this.publish(), options.report)
  }

  snapshot(): ChatSnapshot {
    return structuredClone({ ...this.state, threadId: this.threadId, history: this.historyList.snapshot() })
  }

  publish(): void { if (!this.disposed) this.options.publish(this.snapshot()) }

  async connect(signIn = false): Promise<void> {
    if (this.disposed || this.state.phase !== "disconnected") return
    const generation = ++this.generation
    let acquired: ChatSession | null = null
    this.update({ phase: "connecting", notice: null })
    try {
      this.options.assertTrusted()
      const session = await this.options.connect(signIn, this.lifetime.signal)
      acquired = session
      if (this.disposed || generation !== this.generation) { await session.host.close(); return }
      this.options.assertTrusted()
      this.session = session
      this.historyList.bind({ host: session.host, cwd: session.cwd, authorize: async () => { this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted() } })
      this.historyCursor = null
      this.threadId = null
      this.resetResources()
      this.settings = { ...DEFAULT_APP_SERVER_THREAD_SETTINGS, permissionMode: "default", model: session.model, mcpServers: session.mcpServers }
      this.unsubscribe = session.host.onEvent((event) => {
        if (this.session === session && generation === this.generation) this.onEvent(event)
      })
      this.update({ ...initialSnapshot(), phase: "ready", workspace: session.workspace, model: session.model, mcpNames: session.mcpServers.map((server) => server.name) })
      this.poll = setInterval(() => { void this.refreshBackground() }, 3000)
      this.poll.unref()
    } catch (error) {
      if (acquired && this.session !== acquired) await acquired.host.close()
      if (!this.disposed && generation === this.generation) {
        this.options.report("connect", error)
        this.update({ phase: "disconnected", notice: error instanceof UserVisibleError ? error.message : "连接失败，请查看 CodeM 日志后重试。" })
      }
    }
  }

  async send(text: string): Promise<void> {
    if (this.disposed || this.state.phase !== "ready" || !this.session) return
    if (!text.trim() || text.length > 32_000) return
    const session = this.session
    const active: ActiveTurn = { submissionId: randomUUID(), turnId: null, abort: new AbortController(), requests: new Map(), approvals: Promise.resolve() }
    this.active = active
    this.invalidateHistory()
    this.update({ phase: "sending", notice: null })
    try {
      this.options.assertTrusted()
      for (const attachment of this.attachments.values()) await validateAttachment(attachment)
      if ([...this.attachments.values()].some((attachment) => attachment.kind === "image") && !session.models.find((model) => model.id === this.settings.model)?.supportsVision) throw new UserVisibleError("当前模型不支持图片，请切换模型或移除图片。")
      if (!this.threadId) {
        const threadId = await session.host.startThread(session.cwd, this.settings)
        if (this.session !== session || this.disposed) return
        this.threadId = threadId
      }
      this.options.assertTrusted()
      const attachmentIds = [...this.attachments.keys()]
      const attachments = [...this.attachments.values()]
      this.update({ messages: [...this.state.messages, { id: active.submissionId, role: "user", label: "你", text, ...(this.state.attachments.length ? { attachments: this.state.attachments } : {}) }] })
      const turnId = await session.host.startTurn({ cwd: session.cwd, threadId: this.threadId, submissionId: active.submissionId, text, attachments })
      if (this.session === session && !this.disposed) {
        for (const id of attachmentIds) this.attachments.delete(id)
        this.update({ attachments: this.state.attachments.filter((item) => !attachmentIds.includes(item.id)) })
      }
      // Core can complete the turn before turn/start returns. Never revive it.
      if (this.active === active && this.session === session && !this.disposed) {
        active.turnId = turnId
        this.update({ phase: "running" })
      }
    } catch (error) {
      if (this.active === active) {
        this.active = null
        active.abort.abort()
        this.options.report("send", error)
        this.update({ phase: "ready", notice: error instanceof UserVisibleError ? error.message : "本次发送失败。消息未自动重发，附件保留，可以重试。" })
      }
    }
  }

  async stop(): Promise<void> {
    const session = this.session
    const active = this.active
    if (!session || !active?.turnId || !this.threadId || this.state.phase !== "running") return
    this.update({ phase: "stopping" })
    try {
      await session.host.interruptTurn(session.cwd, this.threadId)
      // The acknowledgement is not terminal; wait for turn/completed.
    } catch (error) {
      if (this.active === active) {
        this.options.report("stop", error)
        this.update({ phase: "running", notice: "停止请求失败，请重试。" })
      }
    }
  }

  async newChat(): Promise<void> {
    if (this.disposed || isBusy(this.state.phase) || this.state.backgroundBusy) return
    if (this.session && this.threadId) {
      const session = this.session
      this.update({ phase: "sending" })
      try {
        await session.host.unsubscribeThread(session.cwd, this.threadId)
        if (this.session !== session || this.disposed) return
      }
      catch (error) {
        if (this.session !== session || this.disposed) return
        this.options.report("newChat", error)
        this.update({ phase: "ready", notice: "无法关闭当前会话，请重试。" })
        return
      }
    }
    this.threadId = null
    this.historyCursor = null
    this.resetResources()
    this.update({ hasOlderMessages: false, historyNeedsRefresh: false, messages: [], attachments: [], diffs: [], background: [], backgroundTasks: [], tools: [], notice: null, phase: this.session ? "ready" : "disconnected" })
  }

  async showHistory(): Promise<void> {
    if (this.disposed || this.state.phase !== "ready") return
    await this.historyList.open()
  }

  closeHistory(): void { this.historyList.close() }
  async refreshHistory(): Promise<void> { if (this.state.phase === "ready") await this.historyList.refresh() }
  async loadMoreThreads(): Promise<void> { if (this.state.phase === "ready") await this.historyList.more() }

  async resumeThread(threadId: string): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy) return
    if (this.historyRead) { this.update({ notice: "正在结束上一次历史读取，请稍后重试。" }); return }
    const entry = this.historyList.snapshot().entries.find((thread) => thread.id === threadId)
    if (!entry || entry.archived) {
      this.update({ notice: "请选择当前工作区列表中可恢复的会话。" })
      return
    }
    if (threadId === this.threadId) {
      await this.reloadHistory()
      if (!this.state.notice) this.historyList.close()
      return
    }
    const previousThreadId = this.threadId
    const abort = new AbortController()
    this.historyRead = abort
    this.restoringThreadId = threadId
    let attached = false
    let releasingPrevious = false
    this.update({ phase: "loadingHistory", notice: null })
    try {
      this.options.assertTrusted()
      await session.authorize()
      this.assertHistoryContext(session, abort)
      const detail = await session.host.readThread(session.cwd, threadId)
      this.assertHistoryContext(session, abort)
      if (detail.archived) throw new UserVisibleError("该会话已归档，无法继续对话。")
      await session.host.resumeThread(session.cwd, threadId, this.settings)
      attached = true
      this.assertHistoryContext(session, abort)
      const modes = await session.host.readModes(session.cwd, threadId)
      this.assertHistoryContext(session, abort)
      const page = await session.readHistory(threadId, undefined, abort.signal)
      this.assertHistoryContext(session, abort)
      const messages = historyMessages(threadId, page)
      if (previousThreadId) {
        releasingPrevious = true
        await session.host.unsubscribeThread(session.cwd, previousThreadId)
        this.assertHistoryContext(session, abort)
      }
      this.threadId = threadId
      this.historyCursor = page.nextCursor
      this.resetResources()
      this.settings = { ...this.settings, permissionMode: modes.permissionMode, workMode: modes.workMode === "plan" ? "plan" : "default" }
      this.update({ phase: "ready", messages, permission: this.settings.permissionMode, workMode: this.settings.workMode, attachments: [], diffs: [], background: [], backgroundTasks: [], tools: [], hasOlderMessages: page.nextCursor !== null, historyNeedsRefresh: false, notice: null })
      this.historyList.close()
    } catch (error) {
      if (this.session !== session || this.disposed) return
      let cleanupFailed = false
      if (attached) {
        try { await session.host.unsubscribeThread(session.cwd, threadId) }
        catch (cleanupError) { cleanupFailed = true; this.options.report("historyCleanup", cleanupError) }
      }
      if (this.session !== session || this.disposed) return
      this.options.report("resumeHistory", error)
      if (releasingPrevious || cleanupFailed) {
        this.update({ phase: "disconnected", notice: "会话切换状态未能确认，已断开连接，请重新连接。" })
        await this.retire()
      } else if (!abort.signal.aborted) {
        this.update({ notice: error instanceof UserVisibleError ? error.message : "会话恢复失败，当前记录已保留。请刷新历史后重试。" })
      }
    } finally {
      if (this.historyRead === abort) { this.historyRead = null; this.restoringThreadId = null }
      if (this.session === session && !this.disposed && this.snapshot().phase === "loadingHistory") this.update({ phase: "ready" })
    }
  }

  async loadOlderMessages(): Promise<void> { if (this.historyCursor) await this.loadHistoryPage(true) }
  async reloadHistory(): Promise<void> { await this.loadHistoryPage(false) }

  private async loadHistoryPage(append: boolean): Promise<void> {
    const session = this.session
    const threadId = this.threadId
    if (!session || !threadId || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy) return
    if (this.historyRead) { this.update({ notice: "正在结束上一次历史读取，请稍后重试。" }); return }
    const cursor = append ? this.historyCursor ?? undefined : undefined
    const abort = new AbortController()
    this.historyRead = abort
    this.update({ phase: "loadingHistory", notice: null })
    try {
      this.options.assertTrusted()
      const page = await session.readHistory(threadId, cursor, abort.signal)
      this.assertHistoryContext(session, abort)
      const messages = historyMessages(threadId, page)
      if (append && (page.nextCursor === cursor || messages.some((message) => this.state.messages.some((old) => old.id === message.id)))) throw new Error("History page overlaps the current snapshot")
      this.historyCursor = page.nextCursor
      this.update({ messages: append ? [...messages, ...this.state.messages] : messages, hasOlderMessages: page.nextCursor !== null, historyNeedsRefresh: false })
    } catch (error) {
      if (this.session !== session || this.disposed || abort.signal.aborted) return
      this.options.report("historyPage", error)
      this.historyCursor = null
      this.update({ hasOlderMessages: false, historyNeedsRefresh: true, notice: "历史记录无法继续读取。当前内容已保留，请点击「重新加载记录」重试。" })
    } finally {
      if (this.historyRead === abort) this.historyRead = null
      if (this.session === session && !this.disposed && this.snapshot().phase === "loadingHistory") this.update({ phase: "ready" })
    }
  }

  private assertHistoryContext(session: ChatSession, abort: AbortController): void {
    abort.signal.throwIfAborted()
    this.options.assertTrusted()
    if (this.session !== session || this.disposed || this.active) throw new Error("History operation no longer belongs to an idle connection")
  }

  private invalidateHistory(): void {
    this.historyRead?.abort()
    const historyNeedsRefresh = this.state.historyNeedsRefresh || this.historyCursor !== null || this.state.messages.some((message) => message.id.startsWith("history:"))
    this.historyCursor = null
    this.update({ hasOlderMessages: false, historyNeedsRefresh })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.lifetime.abort()
    await this.retire()
  }

  private async retire(): Promise<void> {
    const session = this.session
    this.historyRead?.abort()
    this.historyRead = null
    this.restoringThreadId = null
    this.historyCursor = null
    this.historyList.bind(null)
    if (this.poll) clearInterval(this.poll)
    this.poll = null
    this.resetResources()
    this.session = null
    this.generation++
    this.active?.abort.abort()
    this.active = null
    this.unsubscribe?.()
    this.unsubscribe = null
    this.threadId = null
    this.update({ hasOlderMessages: false, historyNeedsRefresh: false })
    await session?.host.close()
  }

  private onEvent(event: AppServerHostEvent): void {
    if (event.type === "connection-closed" || event.type === "protocol-error" || event.type === "authentication-invalidated") {
      this.update({ phase: "disconnected", notice: "连接已中断，请重新连接。已有记录由 Core 保存。" })
      void this.retire().catch((error) => this.options.report("close", error))
      return
    }
    if (event.type === "turn-started" && event.threadId === this.restoringThreadId && event.threadId !== this.threadId) this.historyRead?.abort()
    if ("threadId" in event && event.threadId === this.threadId) {
      if (event.type === "thread-modes-updated") {
        this.settings = { ...this.settings, permissionMode: event.state.permissionMode, workMode: event.state.workMode === "plan" ? "plan" : "default" }
        this.updateSettings()
        return
      }
      if (event.type === "background-wake") {
        const id = [...this.tasks].find(([, taskId]) => taskId === event.taskId)?.[0] ?? randomUUID()
        this.tasks.set(id, event.taskId)
        const previous = this.state.backgroundTasks.find((task) => task.id === id)
        const row = { id, label: previous?.label ?? `后台任务 ${this.tasks.size}`, phase: event.phase }
        this.update({ backgroundTasks: [...this.state.backgroundTasks.filter((task) => task.id !== id), row] })
        return
      }
      if (event.type === "turn-started" && event.submissionId === null && !this.active) {
        this.invalidateHistory()
        this.active = { submissionId: randomUUID(), turnId: event.turnId, abort: new AbortController(), requests: new Map(), approvals: Promise.resolve() }
        this.update({ phase: "running" })
      }
    }
    const active = this.active
    if (!active) return
    if (event.type === "interaction") {
      const request = event.interaction
      if (request.threadId === this.threadId && request.turnId === active.turnId && !active.requests.has(request.requestId)) {
        const abort = new AbortController()
        active.requests.set(request.requestId, abort)
        active.approvals = active.approvals.then(() => this.respond(request, active, abort))
      }
      return
    }
    if (!("threadId" in event) || event.threadId !== this.threadId) return
    if (event.type === "turn-started") {
      if ((event.submissionId !== null && event.submissionId !== active.submissionId) || (active.turnId && active.turnId !== event.turnId)) return
      active.turnId = event.turnId
      this.update({ phase: "running" })
      return
    }
    if (!("turnId" in event) || event.turnId !== active.turnId) return
    if (event.type === "file-diff") {
      const id = randomUUID()
      this.diffs.set(id, event.diff)
      this.update({ diffs: [...this.state.diffs, { id, label: displayPath(this.session!.cwd, event.diff.path), added: event.diff.stats.linesAdded, removed: event.diff.stats.linesRemoved, preview: event.diff.preview.kind }] })
    } else if (event.type === "item-output-delta") {
      this.upsert(`${event.turnId}:${event.itemId}`, "tool", "工具输出", event.delta, true)
    } else if (event.type === "interaction-resolved") {
      active.requests.get(event.requestId)?.abort()
    } else if (event.type === "text-delta" || event.type === "reasoning-delta") {
      this.upsert(`${event.turnId}:${event.itemId}`, event.type === "text-delta" ? "assistant" : "reasoning", event.type === "text-delta" ? "CodeM" : "思考过程", event.delta, true)
    } else if (event.type === "item-started" || event.type === "item-completed") {
      const item = event.item
      if (item.type === "userMessage") return
      if (item.toolName === "final_answer") {
        if (item.finalAnswer?.summary) {
          const answer = [...this.state.messages].reverse().find((message) => message.role === "assistant" && message.id.startsWith(`${event.turnId}:`))
          this.upsert(answer?.id ?? `${event.turnId}:finalAnswer`, "assistant", "CodeM", item.finalAnswer.summary, false)
        }
        return
      }
      const role = item.type === "agentMessage" ? "assistant" : item.type === "reasoning" ? "reasoning" : "tool"
      const text = item.finalAnswer?.summary || item.text || item.output || item.summary
      if (role === "reasoning" && !text && !this.state.messages.some((message) => message.id === `${event.turnId}:${item.id}`)) return
      const status = { inProgress: "进行中", completed: "已完成", failed: "失败", declined: "已拒绝", interrupted: "已停止" }[item.status]
      const tool = { commandExecution: "执行命令", fileChange: "修改文件", mcpToolCall: "调用工具", webSearch: "搜索", contextCompaction: "整理上下文", toolCall: "调用工具", toolResult: "工具结果", subagent: "子任务", reasoning: "思考", agentMessage: "回复", userMessage: "消息" }[item.type]
      // A snapshot with no text must not erase already streamed content.
      this.upsert(`${event.turnId}:${item.id}`, role, role === "assistant" ? "CodeM" : role === "reasoning" ? "思考过程" : `${item.type === "mcpToolCall" ? "MCP · " + (item.toolName ?? tool) : tool} · ${status}`, text, false)
    } else if (event.type === "turn-completed") {
      active.abort.abort()
      this.active = null
      this.update({ phase: "ready", notice: event.outcome === "completed" ? null : event.outcome === "stopped" ? "已停止生成。" : "本轮任务失败，可以继续发送消息。" })
    }
  }

  /** Native UI owns the picker. Holding this phase prevents sends racing a selection. */
  async configure(pick: (settings: AppServerThreadSettings, session: ChatSession) => Promise<AppServerThreadSettings | null>): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy) return
    this.update({ phase: "configuring", notice: null })
    try {
      this.options.assertTrusted()
      const modes = this.threadId ? await session.host.readModes(session.cwd, this.threadId) : null
      if (this.session !== session || this.disposed) return
      if (modes) {
        this.settings = { ...this.settings, permissionMode: modes.permissionMode, workMode: modes.workMode === "plan" ? "plan" : "default" }
        this.updateSettings()
      }
      const next = await pick(structuredClone(this.settings), session)
      if (!next || this.session !== session || this.disposed) return
      this.options.assertTrusted()
      if (!session.models.some((model) => model.id === next.model) || !APP_SERVER_BUILTIN_INTELLIGENCE_TIERS.some((effort) => effort === next.intelligence)) throw new UserVisibleError("模型或思考强度不在 Core 支持的列表中。")
      if (this.active) { this.update({ notice: "后台任务已开始新一轮，请结束后再切换。" }); return }
      let confirmedModes = modes
      if (this.threadId) {
        if (next.model !== this.settings.model || next.intelligence !== this.settings.intelligence || JSON.stringify(next.mcpServers) !== JSON.stringify(this.settings.mcpServers)) {
          await session.host.resumeThread(session.cwd, this.threadId, next)
          if (this.session !== session || this.disposed) return
          this.settings = { ...this.settings, model: next.model, intelligence: next.intelligence, mcpServers: next.mcpServers }
          this.updateSettings()
        }
        if (modes && (modes.permissionMode !== next.permissionMode || modes.workMode !== (next.workMode === "plan" ? "plan" : "normal"))) {
          confirmedModes = await session.host.setModes({ cwd: session.cwd, threadId: this.threadId, expectedRevision: modes.revision, permissionMode: next.permissionMode, workMode: next.workMode === "plan" ? "plan" : "normal" })
        } else {
          confirmedModes = await session.host.readModes(session.cwd, this.threadId)
        }
      }
      if (this.session !== session || this.disposed) return
      this.settings = confirmedModes ? { ...next, permissionMode: confirmedModes.permissionMode, workMode: confirmedModes.workMode === "plan" ? "plan" : "default" } : next
      this.updateSettings()
      this.update({ tools: [] })
    } catch (error) {
      if (this.session !== session || this.disposed) return
      this.options.report("configure", error)
      const notice = error instanceof UserVisibleError ? error.message : "设置未应用；已重新读取当前状态，请重试。"
      if (!this.threadId) { this.update({ notice }); return }
      try {
        // A revision conflict is read back, never retried as an unconditional write.
        const modes = await session.host.readModes(session.cwd, this.threadId)
        if (this.session !== session || this.disposed) return
        this.settings = { ...this.settings, permissionMode: modes.permissionMode, workMode: modes.workMode === "plan" ? "plan" : "default" }
        this.updateSettings()
        this.update({ notice })
      } catch {
        // Failed resume can remove the subscription. Further sends require reconnect.
        if (this.session !== session || this.disposed) return
        this.update({ phase: "disconnected", notice: "设置未能确认，已断开连接。请重新连接后重试。" })
        await this.retire()
      }
    } finally {
      if (this.session === session && !this.disposed && this.snapshot().phase === "configuring") this.update({ phase: "ready" })
    }
  }

  async addAttachments(pick: () => Promise<readonly AppServerPromptAttachment[]>): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy) return
    this.update({ phase: "configuring", notice: null })
    try {
      this.options.assertTrusted()
      const chosen = await pick()
      if (this.session !== session || this.disposed) return
      this.options.assertTrusted()
      const unique = chosen.filter((item, index) => ![...this.attachments.values()].some((old) => old.path === item.path) && chosen.findIndex((other) => other.path === item.path) === index)
      if (this.attachments.size + unique.length > 20) throw new UserVisibleError("每条消息最多添加 20 个附件。")
      for (const item of unique) await validateAttachment(item)
      if (this.session !== session || this.disposed) return
      for (const item of unique) this.attachments.set(randomUUID(), item)
      this.update({ attachments: [...this.attachments].map(([id, item]) => ({ id, label: displayPath(session.cwd, item.path), kind: item.kind })) })
    } catch (error) {
      this.options.report("attachment", error)
      if (this.session === session) this.update({ notice: error instanceof UserVisibleError ? error.message : "附件不可用，请检查文件是否存在；图片不能超过 20 MiB。" })
    } finally {
      if (this.session === session && this.snapshot().phase === "configuring") this.update({ phase: "ready" })
    }
  }

  removeAttachment(id: string): void {
    if (this.state.phase !== "ready") return
    this.attachments.delete(id)
    this.update({ attachments: this.state.attachments.filter((item) => item.id !== id) })
  }

  async showDiff(id: string, show: (diff: AppServerFileDiff, cwd: string) => Promise<void>): Promise<void> {
    const diff = this.diffs.get(id)
    if (!this.session || !diff || this.disposed) return
    this.options.assertTrusted()
    await show(diff, this.session.cwd)
  }

  async refreshTools(): Promise<void> {
    await this.configure(async (settings, session) => {
      if (!this.threadId) {
        const threadId = await session.host.startThread(session.cwd, settings)
        if (this.session !== session || this.disposed) return null
        this.threadId = threadId
      }
      const result = await session.host.listTools(session.cwd, this.threadId)
      if (this.session === session) this.update({ tools: result.tools })
      return null
    })
  }

  async refreshBackground(): Promise<void> { await this.backgroundOperation(async () => undefined) }

  async terminateBackground(id: string): Promise<void> {
    const terminal = this.terminals.get(id)
    if (!terminal) return
    await this.backgroundOperation(async (session, threadId) => { await session.host.terminateBackgroundTerminal(session.cwd, threadId, terminal.processId) })
  }

  async cleanBackground(): Promise<void> {
    await this.backgroundOperation(async (session, threadId) => { await session.host.cleanBackgroundTerminals(session.cwd, threadId) })
  }

  async cancelTask(id: string): Promise<void> {
    const taskId = this.tasks.get(id)
    if (!taskId) return
    await this.backgroundOperation(async (session, threadId) => {
      const phase = await session.host.cancelBackgroundTask(session.cwd, threadId, taskId)
      if (this.session === session && this.threadId === threadId) this.update({ backgroundTasks: this.state.backgroundTasks.map((task) => task.id === id ? { ...task, phase } : task) })
    })
  }

  async showBackgroundLog(id: string, show: (path: string) => Promise<void>): Promise<void> {
    const terminal = this.terminals.get(id)
    if (!terminal || !this.session || this.disposed) return
    this.options.assertTrusted()
    await show(terminal.logPath)
  }

  private async backgroundOperation(run: (session: ChatSession, threadId: string) => Promise<void>): Promise<void> {
    const session = this.session
    const threadId = this.threadId
    if (!session || !threadId || this.disposed || this.state.backgroundBusy || (this.state.phase === "configuring" || this.state.phase === "loadingHistory")) return
    this.update({ backgroundBusy: true })
    try {
      this.options.assertTrusted()
      await run(session, threadId)
      if (this.session !== session || this.threadId !== threadId) return
      const result = await session.host.listBackgroundTerminals(session.cwd, threadId)
      if (this.session !== session || this.threadId !== threadId) return
      const previous = new Map([...this.terminals].map(([id, terminal]) => [terminal.processId, id]))
      this.terminals.clear()
      result.terminals.forEach((terminal) => this.terminals.set(previous.get(terminal.processId) ?? randomUUID(), terminal))
      this.update({ background: [...this.terminals].map(([id, terminal], index) => ({ id, label: `后台进程 ${index + 1}`, inProgress: terminal.inProgress })) })
    } catch (error) {
      this.options.report("background", error)
      if (this.session === session && this.threadId === threadId) this.update({ notice: "后台操作失败，请刷新后重试。" })
    } finally {
      if (this.session === session) this.update({ backgroundBusy: false })
    }
  }

  private updateSettings(): void {
    this.update({ model: this.settings.model, effort: this.settings.intelligence, permission: this.settings.permissionMode, workMode: this.settings.workMode, mcpNames: this.settings.mcpServers.map((server) => server.name) })
  }

  private resetResources(): void {
    this.attachments.clear(); this.diffs.clear(); this.terminals.clear(); this.tasks.clear()
  }

  private async respond(request: AppServerInteraction, active: ActiveTurn, abort: AbortController): Promise<void> {
    const session = this.session
    if (!session || this.active !== active || abort.signal.aborted) return
    const cancel = () => abort.abort()
    active.abort.signal.addEventListener("abort", cancel, { once: true })
    try {
      const response = await this.options.interact(request, abort.signal)
      if (this.active !== active || this.session !== session || abort.signal.aborted) return
      this.options.assertTrusted()
      if (response) await session.host.respondToInteraction(request.requestId, response)
      else await this.stop()
    } catch (error) {
      this.options.report("interaction", error)
      if (this.active === active) {
        this.update({ notice: "审批未完成，任务将停止。" })
        await this.stop()
      }
    } finally { active.abort.signal.removeEventListener("abort", cancel) }
  }

  private upsert(id: string, role: ChatMessage["role"], label: string, text: string, append: boolean): void {
    const previous = this.state.messages.find((message) => message.id === id)
    const message = { id, role, label, text: append ? (previous?.text ?? "") + text : text || previous?.text || "" }
    this.update({ messages: previous ? this.state.messages.map((item) => item.id === id ? message : item) : [...this.state.messages, message] })
  }

  private update(patch: Partial<ChatSnapshot>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    this.publish()
  }
}
