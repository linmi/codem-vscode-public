import { PluginManagement, type PluginManagementContext } from "../plugins/pluginManagement.ts"
import type { PluginCommands, PluginChange, PluginSource } from "@codem/app-server"
import { ConversationSearch } from "../sessionHistory/conversationSearch.ts"
import { type CatalogKind } from "@codem/protocol"
import { attachmentScope, type PasteImagesAction } from "../shared/pastedImages.ts"
import type { ActiveConversation, ConversationScope } from "../sessionHistory/activeConversation.ts"
import { ConversationHistory, HistoryRestoreFailure, type HistoryContext } from "../sessionHistory/conversationHistory.ts"
import { BackgroundTasks, type BackgroundContext } from "./backgroundTasks.ts"
import { UserVisibleError } from "../shared/userVisibleError.ts"
import { ChatSettings, type RestoredSettings } from "./chatSettings.ts"
import { settingPatch, type ComposerSettingAction } from "../shared/composerSettings.ts"
import type { FileDiffContent } from "../resources/filePresentation.ts"
import { realpath, stat } from "node:fs/promises"
import { basename, relative, isAbsolute, sep } from "node:path"
import { LiveSnapshotCatalog } from "./liveSnapshotCatalog.ts"
import { projectCatalog } from "./capabilityCatalog.ts"
import { emptySessionTools, type LiveSnapshotPageKind, type ThreadOperation, type SessionToolsState, emptyCapabilities } from "../shared/capabilityTypes.ts"
import type { SpaceDirectory } from "../connection/spaceDirectory.ts"
import type { SettingsPersistence } from "../connection/connectionPreferences.ts"
import { projectToolDetails } from "./toolDetails.ts"
import type { ArtifactSource } from "../resources/artifacts.ts"
import { ConversationResources } from "../resources/conversationResources.ts"
import { changedFilePath } from "../resources/filePresentation.ts"
import { terminalReplyLast } from "../shared/timelineOrder.ts"
import { randomUUID } from "node:crypto"
import { type AppServerItem, type AppServerThreadSettings, type AppServerModelSummary, type AppServerPromptAttachment, type AppServerHost, type AppServerHostEvent, type AppServerInteraction, type AppServerInteractionResponse } from "@codem/app-server"
import { initialSnapshot, isBusy, type ToolDetails, type AttachmentView, type ActivityMessage, type ActivityStatus, type ChatMessage, type ChatPhase, type ChatSnapshot } from "../shared/messages.ts"

import { HistoryListController } from "../sessionHistory/historyList.ts"
import { historyTurnTimings, historyPlan } from "../sessionHistory/historyMessages.ts"
import { stoppedTurnMessage } from "../shared/turnStatus.ts"
import type { SessionHistoryReader, SessionHistorySearcher } from "../sessionHistory/sessionHistory.ts"

import { displayPath } from "../resources/filePresentation.ts"
import { freezeSnapshot } from "../shared/frozenSnapshot.ts"

export type ChatHost = Pick<AppServerHost, "control" | "compactThread" | "rewindThread" | "clearThread" | "steerTurn" | "startSideQuestion" | "cancelSideQuestion" | "runShellCommand" | "listSkills" | "readEnvironmentInfo" | "readConfigSnapshot" | "listHooks" | "listPlugins" | "listPermissionProfiles" | "readCoreSpaceSnapshot" | "readModelProviderCapabilities" | "listLoadedThreadIds" | "listLiveThreadTurns" | "listLiveThreadItems" | "listThreads" | "readThread" | "resumeThread" | "readModes" | "setModes" | "listTools" | "listBackgroundTerminals" | "terminateBackgroundTerminal" | "cleanBackgroundTerminals" | "cancelBackgroundTask" | "onEvent" | "startThread" | "startTurn" | "interruptTurn" | "unsubscribeThread" | "respondToInteraction" | "close">
export interface ChatSession {
  host: ChatHost
  cwd: string
  workspace: string
  space: { key: string; name: string }
  spaceDirectory: SpaceDirectory
  model: string
  models: readonly AppServerModelSummary[]
  mcpServers: AppServerThreadSettings["mcpServers"]
  authorize: () => Promise<void>
  readHistory: SessionHistoryReader
  pluginCommands: PluginCommands
  searchHistory: SessionHistorySearcher
}
interface ActiveTurn {
  finalReplyId: string | null
  finalAnswerCalls: Set<string>
  toolMessageIds: Map<string, string>
  submissionId: string
  turnId: string | null
  abort: AbortController
  requests: Map<string, AbortController>
  approvals: Promise<void>
}
type ActiveSideQuestion = {
  operationId: string
  id: string | null
  question: string
  answer: string
  status: NonNullable<SessionToolsState["sideQuestion"]>["status"]
}
/** An editor request borrowing the thread's single side-question slot. It never owns chat phase, notices or tools. */
type EditorGeneration = {
  operationId: string
  threadId: string | null
  sideQuestionId: string | null
  answer: string
  cancelled: string | null
  cancelSent: boolean
  /** Answers the editor caller; Core may still hold the slot afterwards. */
  settle: (error: Error | null, text?: string) => void
  cancel: (reason: string) => void
  /** Frees the slot once Core reports a terminal state or forgets the thread. */
  release: (error: Error | null, text?: string) => void
  released: Promise<void>
}
export interface ChatControllerOptions {
  authenticationInvalidated?: () => void
  preferences?: SettingsPersistence
  activeConversation?: ActiveConversation
  connected?: (session: ChatSession) => Promise<void>

  connect: (signal: AbortSignal) => Promise<ChatSession>
  assertTrusted: () => void
  publish: (state: ChatSnapshot) => void
  interact: (request: AppServerInteraction, signal: AbortSignal, cwd: string) => Promise<AppServerInteractionResponse | null>
  report: (operation: string, error: unknown) => void
}

/** One live conversation. Core owns durable history; these are display-only snapshots. */
export class ChatController {
  private pendingSend: { message: ChatMessage & { role: "user" } } | null = null
  private pendingNewChat = false
  private editorGeneration: EditorGeneration | null = null
  private threadStart: { session: ChatSession; thread: Promise<string> } | null = null
  private side: ActiveSideQuestion | null = null
  private controlTurn: ActiveTurn | null = null
  private mutatingThread = false
  private readonly skillNames = new Map<string, string>()
  private readonly directoryPaths = new Map<string, string>()
  private readonly options: ChatControllerOptions
  private session: ChatSession | null = null
  private threadId: string | null = null
  private active: ActiveTurn | null = null
  private unsubscribe: (() => void) | null = null
  private generation = 0
  private readonly retiringHosts = new Set<Promise<void>>()
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private lifetime = new AbortController()
  private accountReset: Promise<void> | null = null
  private readonly connectionTasks = new Set<Promise<void>>()
  private state: ChatSnapshot = initialSnapshot()
  private readonly settings: ChatSettings
  private readonly resources = new ConversationResources()
  private readonly liveSnapshot: LiveSnapshotCatalog
  private readonly background: BackgroundTasks

  private readonly pluginManagement: PluginManagement
  private readonly conversationSearch: ConversationSearch
  private readonly historyList: HistoryListController
  private readonly conversationHistory: ConversationHistory

  constructor(options: ChatControllerOptions) {
    this.options = options
    this.pluginManagement = new PluginManagement(() => this.publish(), options.report)
    this.conversationSearch = new ConversationSearch(() => this.publish(), options.report)
    this.liveSnapshot = new LiveSnapshotCatalog(view => this.updateTools({ catalog: view, ...(view.loading || this.state.sessionTools.busy === "catalog:live" ? { busy: view.loading ? "catalog:live" : null } : {}) }), options.assertTrusted, options.report)
    this.conversationHistory = new ConversationHistory(options.report)
    this.background = new BackgroundTasks((snapshot, notice) => this.update({ ...snapshot, ...(notice ? { notice } : {}) }), options.assertTrusted, options.report)
    this.settings = new ChatSettings({ preferences: options.preferences, report: options.report })
    this.state = { ...this.state, ...this.settings.choices() }
    this.historyList = new HistoryListController(() => this.publish(), options.report)
  }

  /**
   * A frozen snapshot that shares every unchanged object with the previous one, so a streaming delta
   * costs what it changed rather than the whole conversation. State is only ever replaced, never edited.
   */
  snapshot(): ChatSnapshot {
    const pending = this.pendingSend?.message
    const messages = pending && !this.state.messages.some(message => message.id === pending.id)
      ? [...this.state.messages, pending] : this.state.messages
    return freezeSnapshot({ ...this.state, composerCatalog: this.state.phase !== "disconnected" ? this.settings.catalog() : { models: [], spaces: [] }, messages, threadId: this.threadId, history: this.historyList.snapshot(), conversationSearch: this.conversationSearch.snapshot(), pluginManagement: this.pluginManagement.snapshot() })
  }

  /** The current phase without building a snapshot. A call, so an earlier narrowing of `this.state.phase` does not apply. */
  phase(): ChatPhase { return this.state.phase }

  /** The current Core thread without building a snapshot. */
  currentThreadId(): string | null { return this.threadId }

  async assertContextWorkspace(path: string): Promise<void> {
    if (this.session) await changedFilePath(this.session.cwd, path)
  }

  async assertContextDirectory(path: string): Promise<void> {
    if (!this.session) throw new UserVisibleError("请先连接当前工作区。")
    const local = relative(await realpath(this.session.cwd), await realpath(path))
    if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new UserVisibleError("目标不属于当前 CodeM 工作区，请连接对应工作区后重试。")
  }

  publish(): void { if (!this.disposed) this.options.publish(this.snapshot()) }

  connect(): Promise<void> {
    if (this.accountReset) return Promise.resolve()
    return this.trackConnection(this.connectCurrent())
  }

  private trackConnection(task: Promise<void>): Promise<void> {
    this.connectionTasks.add(task)
    const settled = () => { this.connectionTasks.delete(task) }
    void task.then(settled, settled)
    return task
  }

  private async connectCurrent(): Promise<void> {
    if (this.disposed || this.state.phase !== "disconnected") return
    const generation = ++this.generation
    let acquired: ChatSession | null = null
    this.update({ phase: "connecting", notice: null })
    try {
      this.options.assertTrusted()
      const session = await this.options.connect(this.lifetime.signal)
      acquired = session
      if (this.disposed || generation !== this.generation) { await session.host.close(); return }
      this.options.assertTrusted()
      const restored = await this.settings.restore(session)
      if (this.disposed || generation !== this.generation) { await session.host.close(); return }
      this.options.assertTrusted()
      this.bindSession(session, generation, restored, true)
      await this.rememberConnection(session)
      await this.restoreActiveConversation(session)
    } catch (error) {
      if (acquired && this.session !== acquired) await acquired.host.close()
      if (!this.disposed && generation === this.generation) {
        this.options.report("connect", error)
        this.update({ phase: "disconnected", notice: error instanceof UserVisibleError ? error.message : "连接失败，请查看 CodeM 日志后重试。" })
      }
    }
  }

  private bindSession(session: ChatSession, generation: number, restored: RestoredSettings, preserveAttachments = false): void {
    this.session = session
    this.historyList.bind({ host: session.host, cwd: session.cwd, authorize: async () => { this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted() } })
    this.conversationHistory.reset()
    this.threadId = null
    this.resetResources(preserveAttachments)
    const settings = this.settings.bind(session, restored, session.spaceDirectory.list())
    this.directoryPaths.clear()
    this.unsubscribe = session.host.onEvent((event) => {
      if (this.session === session && generation === this.generation) this.onEvent(event)
    })
    this.update({ ...initialSnapshot(), attachments: this.resources.attachmentViews(session.cwd), phase: "connecting", workspace: session.workspace, space: session.space.name, ...settings, notice: restored.notice })
    this.background.startPolling(() => this.backgroundContext())
  }

  private conversationScope(session: ChatSession): ConversationScope {
    return { cwd: session.cwd, spaceKey: session.space.key, accountKey: session.spaceDirectory.accountKey }
  }

  private async rememberActiveConversation(session: ChatSession, threadId: string | null): Promise<void> {
    try { await this.options.activeConversation?.save(this.conversationScope(session), threadId) }
    catch (error) {
      this.options.report("saveActiveConversation", error)
      if (!this.disposed && this.session === session && this.threadId === threadId) this.update({ notice: "当前会话位置保存失败，重载后可能无法恢复；聊天记录仍由 Core 保存。" })
    }
  }

  private async restoreActiveConversation(session: ChatSession): Promise<void> {
    if (this.disposed || this.session !== session) return
    try {
      if (this.pendingNewChat) {
        this.pendingNewChat = false
        await this.rememberActiveConversation(session, null)
        return
      }
      const threadId = await this.options.activeConversation?.load(this.conversationScope(session))
      if (this.disposed || this.session !== session) return
      this.options.assertTrusted()
      if (threadId) {
        const hadPendingSend = this.pendingSend !== null
        this.pendingSend = null
        await this.restoreConversation(session, threadId, true)
        if (hadPendingSend && !this.disposed && this.session === session && this.threadId === threadId) this.update({ notice: "已恢复上次会话，请确认聊天内容后再次发送；输入已保留。" })
      }
    } catch (error) {
      this.options.report("restoreActiveConversation", error)
      if (!this.disposed && this.session === session) {
        this.pendingSend = null
        this.update({ notice: "无法读取上次会话位置，请从历史会话中重新选择。" })
      }
    } finally {
      if (!this.disposed && this.session === session && this.state.phase === "connecting") this.update({ phase: "ready" })
    }
  }

  private async rememberConnection(session: ChatSession): Promise<void> {
    try { await this.options.connected?.(session) }
    catch (error) {
      this.options.report("saveConnection", error)
      if (!this.disposed && this.session === session) this.update({ notice: "已连接，但工作区和空间选择保存失败；重载后需要重新选择。" })
    }
  }

  selectSpace(pick: (session: ChatSession, signal: AbortSignal) => Promise<ChatSession | null>): Promise<void> {
    if (this.accountReset) return Promise.resolve()
    return this.trackConnection(this.selectSpaceCurrent(pick))
  }

  private async selectSpaceCurrent(pick: (session: ChatSession, signal: AbortSignal) => Promise<ChatSession | null>): Promise<void> {
    if (this.state.phase === "disconnected") await this.connect()
    const previous = this.session
    if (!previous || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    this.update({ phase: "configuring", notice: null })
    let next: ChatSession | null = null
    try {
      this.options.assertTrusted()
      next = await pick(previous, this.lifetime.signal)
      if (!next) return
      this.options.assertTrusted()
      if (this.disposed || this.session !== previous || this.active) { await next.host.close(); next = null; return }
      const restored = await this.settings.restore(next)
      if (this.disposed || this.session !== previous || this.active) { await next.host.close(); next = null; return }
      this.options.assertTrusted()
      const retiring = this.retire()
      void retiring.catch(error => this.options.report("retireSpace", error))
      this.bindSession(next, this.generation, restored)
      const connected = next
      next = null
      await this.rememberConnection(connected)
      await this.restoreActiveConversation(connected)
    } catch (error) {
      if (next) await next.host.close()
      this.options.report("selectSpace", error)
      if (!this.disposed && this.session === previous) this.update({ notice: "空间切换失败，请重试或查看 CodeM 日志。" })
    } finally {
      if (!this.disposed && this.phase() === "configuring") this.update({ phase: this.session ? "ready" : "disconnected" })
    }
  }

  /** Native session providers need a Core identity before the first prompt. */
  async createThread(): Promise<string> {
    if (this.disposed || !this.session || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy || this.threadId) throw new UserVisibleError("请先结束当前任务并新建空白会话。")
    const session = this.session
    this.update({ phase: "configuring", notice: null })
    try {
      this.options.assertTrusted()
      await this.reclaimThread()
      await session.authorize()
      this.options.assertTrusted()
      return await this.ensureThread(session)
    } finally {
      if (!this.disposed && this.session === session) this.update({ phase: "ready" })
    }
  }

  private settingsForCore(settings = this.settings.current()): AppServerThreadSettings {
    return { ...settings, additionalDirectories: [...settings.additionalDirectories, this.resources.rootForCore()] }
  }

  private async ensureThread(session: ChatSession): Promise<string> {
    if (this.session !== session || this.disposed) throw new UserVisibleError("连接已关闭。")
    if (this.threadId) return this.threadId
    // Chat and editor generation can both need the first thread; a second thread/start would orphan one.
    if (this.threadStart?.session !== session) {
      const start = { session, thread: this.startFirstThread(session) }
      const settled = () => { if (this.threadStart === start) this.threadStart = null }
      this.threadStart = start
      void start.thread.then(settled, settled)
    }
    return await this.threadStart.thread
  }

  private async startFirstThread(session: ChatSession): Promise<string> {
    const threadId = await session.host.startThread(session.cwd, this.settingsForCore())
    if (this.session !== session || this.disposed) throw new UserVisibleError("创建会话期间连接已关闭，请从历史列表核对。")
    this.threadId = threadId
    await this.rememberActiveConversation(session, threadId)
    if (this.session !== session || this.disposed) throw new UserVisibleError("连接已关闭。")
    return threadId
  }

  async send(text: string): Promise<boolean> {
    if (this.disposed || this.pendingSend || !text.trim() || text.length > 32_000) return false
    if (this.state.phase !== "disconnected" && this.state.phase !== "ready") return false
    const request: { message: ChatMessage & { role: "user" } } = { message: { id: randomUUID(), role: "user", label: "你", text, ...(this.state.attachments.length ? { attachments: this.state.attachments } : {}) } }
    this.pendingSend = request
    const connecting = this.state.phase === "disconnected"
    const generation = this.generation + (connecting ? 1 : 0)
    try {
      if (connecting) await this.connect()
      if (this.pendingSend !== request || this.generation !== generation) return false
      if (connecting && this.threadId !== null) {
        this.update({ notice: "已恢复上次会话，请确认聊天内容后再次发送；输入已保留。" })
        return false
      }
      if (this.conversationSearch.snapshot().historical) {
        await this.loadHistoryPage(false)
        if (this.conversationSearch.snapshot().historical || this.state.historyNeedsRefresh || this.pendingSend !== request || this.generation !== generation) return false
      }
      return await this.sendConnected(request.message)
    } finally {
      if (this.pendingSend === request) { this.pendingSend = null; this.publish() }
    }
  }

  private async sendConnected(message: ChatMessage & { role: "user" }): Promise<boolean> {
    const text = message.text
    if (this.disposed || this.state.phase !== "ready" || !this.session || this.state.sessionTools.busy) return false
    if (!text.trim() || text.length > 32_000) return false
    const session = this.session
    const active: ActiveTurn = { submissionId: message.id, turnId: null, abort: new AbortController(), finalReplyId: null, finalAnswerCalls: new Set(), toolMessageIds: new Map(), requests: new Map(), approvals: Promise.resolve() }
    const attachmentIds = this.resources.selectedIds()
    const consumeAttachments = () => {
      if (this.session !== session || this.disposed) return
      for (const id of attachmentIds) this.resources.remove(id)
      this.updateTools({ selectedSkill: null })
      this.update({ attachments: this.state.attachments.filter((item) => !attachmentIds.includes(item.id)) })
    }
    if (this.editorGeneration) {
      this.update({ phase: "sending", notice: null })
      const refusal = await this.yieldEditorForTurn(session)
      if (refusal !== null) {
        if (this.session === session && !this.disposed) this.update({ ...(this.phase() === "sending" ? { phase: "ready" as const } : {}), notice: refusal })
        return false
      }
    }
    this.active = active
    this.invalidateHistory()
    this.update({ phase: "sending", notice: null, capabilities: { ...this.state.capabilities, changes: [], guards: [], hooks: [] } })
    try {
      this.options.assertTrusted()
      // Core accepts localImage independently of native model vision (e.g. describe_image).
      await this.resources.validateSelection()
      const threadId = await this.ensureThread(session)
      this.options.assertTrusted()
      const attachments = this.resources.selected()
      this.update({ messages: [...this.state.messages, message] })
      const skillId = this.state.sessionTools.selectedSkill
      const skillName = skillId === null ? undefined : this.skillNames.get(skillId)
      if (skillId !== null && !skillName) throw new UserVisibleError("技能目录已变化，请重新选择技能。")
      if (skillName && attachments.length) throw new UserVisibleError("技能输入暂不支持附件，请先移除附件。")
      const turnId = await session.host.startTurn({ cwd: session.cwd, threadId, submissionId: active.submissionId, text, attachments, ...(skillName ? { skillName } : {}) })
      consumeAttachments()
      // Core can complete the turn before turn/start returns. Never revive it.
      if (this.active === active && this.session === session && !this.disposed) {
        active.turnId = turnId
        this.startTiming(turnId, active.submissionId)
        this.update({ phase: "running" })
      }
      return true
    } catch (error) {
      if (active.turnId !== null) consumeAttachments()
      if (this.active === active && active.turnId !== null) {
        this.options.report("send", error)
        this.update({ notice: "Core 已接收消息，但发送回执未能确认；请等待当前任务完成。" })
        return true
      }
      if (this.active === active) {
        this.finishActivities("incomplete")
        this.active = null
        active.abort.abort()
        this.options.report("send", error)
        this.update({ phase: "ready", notice: error instanceof UserVisibleError ? error.message : "发送未能确认，请检查会话后再重试；未自动重发。", ...(active.turnId === null ? { messages: this.state.messages.filter((message) => message.id !== active.submissionId) } : {}) })
      }
      // A correlated start event is acceptance even if the RPC reply is lost.
      return active.turnId !== null
    }
  }

  private updateTools(patch: Partial<SessionToolsState>): void {
    this.update({ sessionTools: { ...this.state.sessionTools, ...patch } })
  }

  closePluginManagement(): void { this.pluginManagement.close() }
  cancelPluginOperation(): void { this.pluginManagement.cancel() }
  async showPluginManagement(): Promise<void> { await this.withPluginManagement(context => this.pluginManagement.refresh(context)) }
  async installPlugin(pick: (signal: AbortSignal) => Promise<PluginSource | null>): Promise<void> { await this.withPluginManagement(context => this.pluginManagement.install(context, pick)) }
  async changePlugin(action: PluginChange, id: string): Promise<void> { await this.withPluginManagement(context => this.pluginManagement.change(context, action, id)) }
  private async withPluginManagement(run: (context: PluginManagementContext) => Promise<void>): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.sessionTools.busy || this.state.backgroundBusy || this.active || this.side || this.pluginManagement.busy) return
    this.conversationSearch.close()
    this.update({ phase: "configuring", notice: null })
    try {
      await run({
        commands: session.pluginCommands,
        authorize: () => session.authorize(),
        assertCurrent: () => { this.options.assertTrusted(); if (this.session !== session || this.disposed || this.active || this.side) throw new Error("Plugin operation context expired") },
        skills: () => session.host.listSkills(session.cwd, this.threadId ?? undefined),
        acceptSkills: skills => {
          this.skillNames.clear()
          const rows = skills.map(skill => { const id = randomUUID(); this.skillNames.set(id, skill.name); return { id, name: skill.name, description: skill.description } })
          this.updateTools({ selectedSkill: null, skills: rows, catalog: null })
        },
      })
    } finally { if (this.session === session && !this.disposed && this.phase() === "configuring") this.update({ phase: "ready" }) }
  }

  async loadCatalog(kind: CatalogKind): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.sessionTools.busy || !["ready", "running"].includes(this.state.phase)) return
    if (kind === "live") {
      await this.liveSnapshot.refresh({ host: session.host, cwd: session.cwd, threadId: this.threadId, authorize: () => session.authorize() })
      return
    }
    this.liveSnapshot.clear()
    this.updateTools({ busy: `catalog:${kind}`, ...(this.state.sessionTools.catalog?.kind === "live" ? { catalog: null } : {}) })
    // An editor generation may be creating this conversation's first thread; read the catalog for it.
    if (this.threadStart) await this.threadStart.thread.catch(() => undefined)
    let threadId = this.threadId
    try {
      this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted()
      if (this.session !== session || this.threadId !== threadId) return
      if (kind === "tools") {
        threadId = await this.ensureThread(session)
        const result = await session.host.listTools(session.cwd, threadId)
        if (this.session !== session || this.threadId !== threadId) return
        this.update({ tools: result.tools })
        this.updateTools({ catalog: { kind, loaded: true, stale: false, rows: result.tools.map(label => ({ label, detail: "当前会话可用工具" })) } })
      } else if (kind === "skills") {
        const skills = await session.host.listSkills(session.cwd, threadId ?? undefined)
        if (this.session !== session || this.threadId !== threadId) return
        const previous = new Map([...this.skillNames].map(([id, name]) => [name, id]))
        this.skillNames.clear()
        const rows = skills.map(skill => { const id = previous.get(skill.name) ?? randomUUID(); this.skillNames.set(id, skill.name); return { id, name: skill.name, description: skill.description } })
        const selected = this.state.sessionTools.selectedSkill
        this.updateTools({ skills: rows, selectedSkill: selected && this.skillNames.has(selected) ? selected : null, catalog: { kind, loaded: true, stale: false, rows: rows.map(skill => ({ label: skill.name, detail: skill.description })) } })
      } else {
        const rows = await projectCatalog(session.host, session.cwd, kind)
        if (this.session !== session || this.threadId !== threadId) return
        this.updateTools({ catalog: { kind, rows, loaded: true, stale: false } })
      }
    } catch (error) {
      this.options.report("catalog", error)
      if (this.session === session && this.threadId === threadId) this.update({ notice: "目录读取失败，已有结果保留；请刷新重试。" })
    } finally { if (this.session === session && this.threadId === threadId) this.updateTools({ busy: null }) }
  }

  async loadMoreLiveSnapshot(snapshotId: string, kind: LiveSnapshotPageKind): Promise<void> {
    if (!this.session || this.disposed || this.state.sessionTools.busy || !["ready", "running"].includes(this.state.phase)) return
    await this.liveSnapshot.more(snapshotId, kind)
  }

  cancelLiveSnapshot(snapshotId: string): void { this.liveSnapshot.cancel(snapshotId) }

  selectSkill(id: string | null): void {
    if (this.state.phase !== "ready" || (id !== null && !this.skillNames.has(id))) return
    this.updateTools({ selectedSkill: id })
  }

  async steer(text: string, requestId: string): Promise<void> {
    const session = this.session, active = this.active, threadId = this.threadId
    if (!session || !active?.turnId || !threadId || this.state.phase !== "running" || this.state.sessionTools.busy) return
    this.updateTools({ busy: "steer", result: null })
    try {
      this.options.assertTrusted()
      await session.host.steerTurn({ cwd: session.cwd, threadId, submissionId: requestId, text })
      if (this.session !== session || this.threadId !== threadId) return
      this.liveSnapshot.invalidate()
      this.update({ messages: [...this.state.messages, { id: requestId, role: "user", label: "补充指令", text, turnId: active.turnId }] })
      this.updateTools({ result: { requestId, accepted: true } })
    } catch (error) {
      this.options.report("steer", error)
      if (this.session === session && this.threadId === threadId) {
        this.updateTools({ result: { requestId, accepted: false } })
        this.update({ notice: "补充指令未能确认，内容已保留；不会自动重发。" })
      }
    } finally { if (this.session === session && this.threadId === threadId) this.updateTools({ busy: null }) }
  }

  async askSideQuestion(text: string, requestId: string): Promise<void> {
    const session = this.session, threadId = this.threadId
    if (!session || !threadId || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    const side: ActiveSideQuestion = { operationId: requestId, id: null, question: text, answer: "", status: "starting" }
    this.side = side
    this.update({ phase: "sideQuestion", notice: null })
    this.publishSideQuestion(side)
    this.updateTools({ result: null })
    try {
      this.options.assertTrusted()
      await this.reclaimThread()
      await session.authorize(); this.options.assertTrusted()
      if (this.session !== session || this.side !== side) return
      const id = await session.host.startSideQuestion(session.cwd, threadId, requestId, text)
      if (this.session !== session || this.threadId !== threadId) return
      if (this.side === side) { side.id = id; if (side.status === "starting") side.status = "running"; this.publishSideQuestion(side) }
      this.updateTools({ result: { requestId, accepted: true } })
    } catch (error) {
      this.options.report("sideQuestion", error)
      if (this.session !== session || this.threadId !== threadId) return
      if (this.side === side && side.id === null) { this.side = null; side.status = "failed"; this.update({ phase: "ready" }); this.publishSideQuestion(side) }
      this.updateTools({ result: { requestId, accepted: side.id !== null } })
      this.update({ notice: error instanceof UserVisibleError ? error.message : "旁路提问回执未能确认；内容保留，不自动重试。" })
    }
  }

  /** Platform text generation shares the idle connection; it never starts an Agent turn. */
  contextKey(): string { return `${this.generation}:${this.threadId ?? ""}` }

  /** Cheap, immutable readiness/identity for frequent editor callbacks; never copies chat history. */
  completionContext(): { ready: boolean; key: string } {
    return {
      ready: !!this.session && !this.disposed && this.state.phase === "ready" && !this.state.backgroundBusy && !this.state.sessionTools.busy && !this.editorGeneration,
      key: `${this.contextKey()}:${this.settings.current().model}:${this.settings.current().intelligence}`,
    }
  }

  /** Borrows the thread's side-question slot without taking the chat phase; any chat operation on the thread reclaims it. */
  async generateText(text: string, signal: AbortSignal, expectedContext: string): Promise<string> {
    if (expectedContext !== this.contextKey()) throw new UserVisibleError("CodeM 会话已切换，请重新发起生成。")
    signal.throwIfAborted()
    if (!this.completionContext().ready) throw new UserVisibleError(this.editorGeneration ? "另一项编辑器生成仍在进行，请等待其结束后重试。" : "请先连接 CodeM，并等待当前任务结束。")
    if (!text.trim() || text.length > 32_000) throw new UserVisibleError("生成请求为空或过长。")
    const session = this.session!
    let free!: () => void
    const released = new Promise<void>(resolve => { free = resolve })
    return new Promise<string>((resolve, reject) => {
      let settled = false
      let recovery: ReturnType<typeof setTimeout> | undefined
      const settle = (error: Error | null, result = "") => {
        if (settled) return
        settled = true
        clearTimeout(timeout); clearTimeout(recovery); signal.removeEventListener("abort", abort)
        if (error) reject(error); else if (!result.trim()) reject(new UserVisibleError("模型没有返回可用内容，请重试。")); else resolve(result)
      }
      const generation: EditorGeneration = {
        operationId: randomUUID(), threadId: this.threadId, sideQuestionId: null, answer: "", cancelled: null, cancelSent: false, released, settle,
        cancel: reason => {
          if (generation.cancelled !== null || this.editorGeneration !== generation) return
          generation.cancelled = reason
          void this.cancelEditorSideQuestion(generation)
          // A cancel receipt is not a terminal event. Answer the caller but keep the chat connected; the slot stays held until Core settles it.
          recovery = setTimeout(() => settle(new UserVisibleError(`${reason}Core 尚未确认结束。`)), 5000)
        },
        release: (error, result) => {
          if (this.editorGeneration !== generation) return
          this.editorGeneration = null
          settle(error, result)
          free()
        },
      }
      const abort = () => generation.cancel("生成已取消。")
      const timeout = setTimeout(() => generation.cancel("生成等待超过 45 秒，已取消。"), 45000)
      this.editorGeneration = generation
      signal.addEventListener("abort", abort, { once: true })
      void this.startEditorGeneration(session, generation, text)
    })
  }

  private async startEditorGeneration(session: ChatSession, generation: EditorGeneration, text: string): Promise<void> {
    try {
      this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted()
      if (this.editorGeneration !== generation) return
      // A blank chat's first thread is the conversation's identity; only an idle chat lets an editor request create it.
      if (!this.threadId && (this.state.phase !== "ready" || this.state.sessionTools.busy)) generation.cancel("聊天开始了新操作，编辑器生成已取消。")
      if (generation.cancelled !== null) throw new UserVisibleError(generation.cancelled)
      const created = !this.threadId
      const threadId = await this.ensureThread(session)
      if (this.editorGeneration !== generation) return
      // A blank chat's first thread becomes the conversation's own; publish that identity immediately.
      if (created) this.publish()
      generation.threadId = threadId
      if (generation.cancelled !== null) throw new UserVisibleError(generation.cancelled)
      this.acceptEditorSideQuestion(generation, await session.host.startSideQuestion(session.cwd, threadId, generation.operationId, text))
    } catch (error) {
      if (this.editorGeneration !== generation) return
      if (generation.cancelled === null) this.options.report("textGeneration", error)
      // The App Server clears its side-question slot when the start fails.
      generation.release(new UserVisibleError(generation.cancelled ?? "生成未能启动，请检查连接后重试。"))
    }
  }

  private acceptEditorSideQuestion(generation: EditorGeneration, id: string): void {
    if (this.editorGeneration !== generation) return
    generation.sideQuestionId ??= id
    void this.cancelEditorSideQuestion(generation)
  }

  /** At most one cancel per generation; Core's terminal event, not the receipt, frees the slot. */
  private async cancelEditorSideQuestion(generation: EditorGeneration): Promise<void> {
    const session = this.session, { threadId, sideQuestionId } = generation
    if (!session || generation.cancelled === null || generation.cancelSent || !threadId || !sideQuestionId) return
    generation.cancelSent = true
    try { this.options.assertTrusted(); await session.host.cancelSideQuestion(session.cwd, threadId, sideQuestionId) }
    catch (error) { this.options.report("cancelTextGeneration", error) }
  }

  /** Chat owns its thread. An editor generation yields the single side-question slot before chat writes to or replaces the thread. */
  private async reclaimThread(): Promise<void> {
    const generation = this.editorGeneration
    if (!generation) return
    generation.cancel("聊天开始了新操作，编辑器生成已取消。")
    let timer: ReturnType<typeof setTimeout> | undefined
    const released = await Promise.race([generation.released.then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(resolve, 5000, false) })])
    clearTimeout(timer)
    if (!released) throw new UserVisibleError("编辑器生成尚未结束，本次操作未执行；请稍后重试。")
  }

  /** Reclaims before a turn is claimed, so a Core-started turn during the wait is never taken for this one. Returns a refusal notice, or null. */
  private async yieldEditorForTurn(session: ChatSession): Promise<string | null> {
    try { await this.reclaimThread() }
    catch (error) { this.options.report("reclaimThread", error); return error instanceof UserVisibleError ? error.message : "编辑器生成尚未结束，本次操作未执行；请稍后重试。" }
    if (this.session !== session || this.disposed) return "连接已关闭。"
    return this.active ? "Core 已开始新一轮任务，本次操作未执行；输入已保留。" : null
  }

  private publishSideQuestion(side: ActiveSideQuestion): void {
    this.updateTools({ sideQuestion: { question: side.question, answer: side.answer, status: side.status } })
  }

  async cancelSideQuestion(): Promise<void> {
    const session = this.session, side = this.side, threadId = this.threadId
    if (!session || !side?.id || !threadId || side.status !== "running") return
    side.status = "stopping"; this.publishSideQuestion(side)
    try { this.options.assertTrusted(); await session.host.cancelSideQuestion(session.cwd, threadId, side.id) }
    catch (error) {
      this.options.report("cancelSideQuestion", error)
      if (this.side === side) { side.status = "running"; this.publishSideQuestion(side); this.update({ notice: "取消失败，请重试。" }) }
    }
  }

  async startControl(kind: "compact" | "rewind", requestId: string): Promise<void> {
    const session = this.session, threadId = this.threadId
    if (!session || !threadId || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    const active: ActiveTurn = { submissionId: requestId, turnId: null, abort: new AbortController(), finalReplyId: null, finalAnswerCalls: new Set(), toolMessageIds: new Map(), requests: new Map(), approvals: Promise.resolve() }
    if (this.editorGeneration) {
      this.updateTools({ busy: kind, result: null }); this.update({ phase: "sending", notice: null })
      const refusal = await this.yieldEditorForTurn(session)
      if (refusal !== null) {
        if (this.session === session && !this.disposed) { this.updateTools({ busy: null, result: { requestId, accepted: false } }); this.update({ ...(this.phase() === "sending" ? { phase: "ready" as const } : {}), notice: refusal }) }
        return
      }
    }
    this.active = active; this.controlTurn = active
    this.updateTools({ busy: kind })
    this.invalidateHistory()
    this.update({ phase: "sending", notice: null })
    try {
      this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted()
      if (this.session !== session || this.active !== active) return
      const turnId = await (kind === "compact" ? session.host.compactThread(session.cwd, threadId) : session.host.rewindThread(session.cwd, threadId))
      if (this.session !== session || this.threadId !== threadId) return
      if (this.active === active) { active.turnId = turnId; this.startTiming(turnId, requestId); this.update({ phase: "running" }) }
      this.updateTools({ result: { requestId, accepted: true } })
    } catch (error) {
      this.options.report(kind, error)
      if (this.session !== session || this.threadId !== threadId) return
      if (this.active === active && active.turnId === null) { this.active = null; this.controlTurn = null; active.abort.abort(); this.updateTools({ busy: null }); this.update({ phase: "ready" }) }
      this.update({ notice: error instanceof UserVisibleError ? error.message : "操作未能确认，已有记录保留；请检查当前状态后重试。" })
      this.updateTools({ result: { requestId, accepted: active.turnId !== null } })
    }
  }

  async manageThread(operation: ThreadOperation | "clear", threadId: string, name: string, requestId: string): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    if (threadId !== this.threadId && !this.historyList.snapshot().entries.some(entry => entry.id === threadId)) return
    this.mutatingThread = true
    this.update({ phase: "configuring", notice: null }); this.updateTools({ busy: operation, result: null })
    let written = false
    try {
      this.options.assertTrusted()
      if (threadId === this.threadId) await this.reclaimThread()
      await session.authorize(); this.options.assertTrusted()
      if (this.session !== session) return
      await session.host.readThread(session.cwd, threadId)
      if (this.session !== session || this.active) return
      this.options.assertTrusted()
      if (operation === "clear") {
        if (threadId !== this.threadId) throw new Error("Clear requires current thread")
        const id = await session.host.clearThread(session.cwd, threadId, requestId)
        written = true
        if (this.session !== session) return
        this.threadId = id; this.invalidateHistory(); this.resetResources()
        await this.rememberActiveConversation(session, id)
        if (this.session !== session || this.disposed) return
        const modes = await session.host.readModes(session.cwd, id)
        if (this.session !== session || this.threadId !== id) return
        this.update({ ...this.settings.acceptModes(modes), messages: [], turnTimings: [], diffs: [], attachments: [], background: [], backgroundTasks: [], tools: [], historyNeedsRefresh: false })
      } else {
        const method = { rename: "thread/name/set", fork: "thread/fork", archive: "thread/archive", unarchive: "thread/unarchive", delete: "thread/delete" } as const
        const result = await session.host.control(session.cwd, method[operation], { threadId, ...(operation === "rename" ? { name } : {}) })
        written = true
        if (this.session !== session) return
        if (operation === "fork" && (typeof result.threadId !== "string" || !result.threadId.trim())) throw new Error("Invalid fork response")
      }
      this.updateTools({ result: { requestId, accepted: true } })
      await this.historyList.refresh()
      if (this.session === session) this.update({ notice: operation === "fork" ? "分叉已创建，可从历史列表选择继续。" : "会话操作已完成。" })
    } catch (error) {
      this.options.report(operation, error)
      if (this.session === session) {
        this.updateTools({ result: { requestId, accepted: written } })
        this.update({ notice: written ? "操作已提交，但结果刷新失败；请刷新历史列表。" : error instanceof UserVisibleError ? error.message : "操作未能确认，未自动重试；请刷新历史列表核对后再操作。" })
      }
    } finally {
      this.mutatingThread = false
      if (this.session === session) { this.updateTools({ busy: null }); if (this.phase() === "configuring") this.update({ phase: "ready" }) }
    }
  }

  async shellCommand(command: string, requestId: string): Promise<void> {
    const session = this.session, threadId = this.threadId
    if (!session || !threadId || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    this.update({ phase: "configuring", notice: null }); this.updateTools({ busy: "shell", result: null })
    try {
      this.options.assertTrusted()
      await this.reclaimThread()
      await session.authorize(); this.options.assertTrusted()
      if (this.session !== session || this.threadId !== threadId || this.active) return
      await session.host.runShellCommand(session.cwd, threadId, command)
      if (this.session !== session || this.threadId !== threadId) return
      this.updateTools({ result: { requestId, accepted: true } })
      this.update({ notice: "命令已提交；此操作不提供输出预览，可检查文件或后台日志。" })
    } catch (error) {
      this.options.report("shellCommand", error)
      if (this.session === session && this.threadId === threadId) { this.updateTools({ result: { requestId, accepted: false } }); this.update({ notice: error instanceof UserVisibleError ? error.message : "命令未能确认，请核对执行结果后再重试。" }) }
    } finally {
      if (this.session === session && this.threadId === threadId) { this.updateTools({ busy: null }); if (this.phase() === "configuring") this.update({ phase: "ready" }) }
    }
  }

  async addDirectory(pick: () => Promise<readonly string[]>): Promise<void> {
    await this.configure(async settings => {
      const paths = await pick()
      if (!paths.length) return null
      const directories = new Set(settings.additionalDirectories)
      for (const path of paths) {
        const canonical = await realpath(path)
        if (!(await stat(canonical)).isDirectory()) throw new Error("Additional root is not a directory")
        directories.add(canonical)
      }
      return { ...settings, additionalDirectories: [...directories] }
    })
    this.projectDirectories()
  }

  async removeDirectory(id: string): Promise<void> {
    const path = this.directoryPaths.get(id)
    if (!path) return
    await this.configure(async settings => ({ ...settings, additionalDirectories: settings.additionalDirectories.filter(value => value !== path) }))
    this.projectDirectories()
  }

  private projectDirectories(): void {
    const previous = new Map([...this.directoryPaths].map(([id, path]) => [path, id]))
    this.directoryPaths.clear()
    const directories = this.settings.current().additionalDirectories.map(path => { const id = previous.get(path) ?? randomUUID(); this.directoryPaths.set(id, path); return { id, label: basename(path) } })
    this.updateTools({ directories })
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
    if (this.disposed || isBusy(this.state.phase) || this.state.backgroundBusy || this.state.sessionTools.busy) return
    this.pendingSend = null
    if (this.session && (this.threadId || this.editorGeneration)) {
      const session = this.session
      this.update({ phase: "sending" })
      try {
        // Leaving the thread frees Core's slot too, so an editor generation that never settles cannot trap the chat.
        await this.reclaimThread().catch(() => undefined)
        if (this.threadId) await session.host.unsubscribeThread(session.cwd, this.threadId)
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
    this.pendingNewChat = this.session === null
    const saved = this.session ? this.rememberActiveConversation(this.session, null) : Promise.resolve()
    this.conversationHistory.invalidate()
    this.resetResources()
    this.update({ hasOlderMessages: false, historyNeedsRefresh: false, messages: [], turnTimings: [], attachments: [], diffs: [], background: [], backgroundTasks: [], tools: [], notice: null, phase: this.session ? "ready" : "disconnected" })
    await saved
  }

  async toggleHistory(): Promise<void> {
    if (this.historyList.snapshot().open) this.closeHistory()
    else await this.showHistory()
  }

  async showHistory(): Promise<void> {
    if (this.state.phase === "disconnected") await this.connect()
    if (this.disposed || this.state.phase !== "ready") return
    await this.historyList.open()
  }

  closeHistory(): void { this.historyList.close() }
  async refreshHistory(): Promise<void> { if (this.state.phase === "ready") await this.historyList.refresh() }
  async loadMoreThreads(): Promise<void> { if (this.state.phase === "ready") await this.historyList.more() }

  async resumeThread(threadId: string): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    if (this.conversationHistory.busy) { this.update({ notice: "正在结束上一次历史读取，请稍后重试。" }); return }
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
    await this.restoreConversation(session, threadId)
  }

  private async restoreConversation(session: ChatSession, threadId: string, initializing = false): Promise<void> {
    this.update({ phase: initializing ? "connecting" : "loadingHistory", notice: null })
    let saved = Promise.resolve()
    let restored = false
    try {
      await this.reclaimThread()
      await this.conversationHistory.restore(this.historyContext(session), threadId, this.threadId, this.settingsForCore(), ({ page, modes }) => {
        this.resetResources()
        const messages = this.resources.projectHistory(threadId, page, session.cwd)
        const diffs = this.resources.restoreDiffs(session.cwd, page, true, this.state.diffs)
        const settings = this.settings.acceptModes(modes)
        this.threadId = threadId
        restored = true
        saved = this.rememberActiveConversation(session, threadId)
        this.update({ phase: "ready", capabilities: { ...this.state.capabilities, plan: historyPlan(page) }, messages, turnTimings: historyTurnTimings(page), ...settings, attachments: [], diffs, background: [], backgroundTasks: [], tools: [], hasOlderMessages: page.nextCursor !== null, historyNeedsRefresh: false, notice: null })
        this.historyList.close()
      })
      await saved
      if (initializing && !restored && this.session === session && !this.disposed) this.update({ notice: "上次会话恢复已中止，请从历史会话中重试。" })
    } catch (error) {
      if (this.session !== session || this.disposed) return
      if (error instanceof UserVisibleError) { this.update({ notice: error.message }); return }
      if (!(error instanceof HistoryRestoreFailure)) throw error
      if (error.disconnect) {
        this.update({ phase: "disconnected", notice: "会话切换状态未能确认，已断开连接，请重新连接。" })
        await this.retire()
      } else {
        this.update({ notice: error.cause instanceof UserVisibleError ? error.cause.message : initializing ? "上次会话未能恢复，记录未被清除。请从历史会话中重试或新建会话。" : "会话恢复失败，当前记录已保留。请刷新历史后重试。" })
      }
    } finally {
      if (this.session === session && !this.disposed && this.phase() === "loadingHistory") this.update({ phase: "ready" })
    }
  }

  async loadOlderMessages(): Promise<void> { if (this.conversationHistory.hasOlder) await this.loadHistoryPage(true) }
  async reloadHistory(): Promise<void> { await this.loadHistoryPage(false) }

  showConversationSearch(): void { if (this.threadId && this.state.phase === "ready") this.conversationSearch.open() }
  closeConversationSearch(): void { this.conversationSearch.close() }
  async searchConversation(query: string): Promise<void> {
    const session = this.session, threadId = this.threadId
    if (!session || !threadId || this.state.phase !== "ready" || this.state.sessionTools.busy || !query.trim() || query.trim().length > 512) return
    await this.conversationSearch.search(session.searchHistory, threadId, query.trim(), () => {
      this.options.assertTrusted()
      if (this.session !== session || this.threadId !== threadId || this.state.phase !== "ready" || this.disposed) throw new Error("Search context expired")
    })
  }
  async selectConversationSearchHit(id: string): Promise<void> {
    const hit = this.conversationSearch.resolve(id)
    if (hit) await this.loadHistoryPage(false, null, hit)
  }


  private async loadHistoryPage(append: boolean, terminalNotice: string | null = null, hit?: { cursor: string; messageId: string }): Promise<void> {
    const session = this.session
    const threadId = this.threadId
    if (!session || !threadId || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    if (this.conversationHistory.busy) { this.update({ notice: "正在结束上一次历史读取，请稍后重试。" }); return }
    this.update({ phase: "loadingHistory", notice: terminalNotice })
    try {
      await this.conversationHistory.load(this.historyContext(session), threadId, append, page => {
        const messages = this.resources.projectHistory(threadId, page, session.cwd)
        if (append && messages.some(message => this.state.messages.some(old => old.id === message.id))) throw new Error("History page overlaps the current snapshot")
        if (hit && !messages.some(message => message.id === hit.messageId)) throw new Error("Search target disappeared")
        const diffs = this.resources.restoreDiffs(session.cwd, page, !append, this.state.diffs)
        this.update({ capabilities: { ...this.state.capabilities, plan: append ? this.state.capabilities.plan : historyPlan(page) }, diffs, messages: append ? [...messages, ...this.state.messages] : messages, turnTimings: append ? [...historyTurnTimings(page), ...this.state.turnTimings] : historyTurnTimings(page), hasOlderMessages: page.nextCursor !== null, historyNeedsRefresh: false })
        if (hit) this.conversationSearch.selected(hit.messageId)
        else if (!append) this.conversationSearch.latest()
      }, hit?.cursor)
    } catch {
      if (this.session !== session || this.disposed) return
      if (hit) this.conversationSearch.failed()
      this.update({ hasOlderMessages: false, historyNeedsRefresh: true, notice: "历史记录无法继续读取。当前内容已保留，请点击「重新加载记录」重试。" })
    } finally {
      if (this.session === session && !this.disposed && this.phase() === "loadingHistory") this.update({ phase: "ready" })
    }
  }

  private historyContext(session: ChatSession): HistoryContext {
    return {
      host: session.host, cwd: session.cwd, authorize: () => session.authorize(),
      readHistory: (...args) => session.readHistory(...args),
      connected: () => this.session === session && !this.disposed,
      assertCurrent: () => {
        this.options.assertTrusted()
        if (this.session !== session || this.disposed || this.active) throw new Error("History operation no longer belongs to an idle connection")
      },
    }
  }

  private invalidateHistory(): void {
    this.conversationSearch.reset()
    const historyNeedsRefresh = this.state.historyNeedsRefresh || this.conversationHistory.hasOlder || this.state.messages.some(message => message.id.startsWith("history:"))
    this.conversationHistory.invalidate()
    this.update({ hasOlderMessages: false, historyNeedsRefresh })
  }

  resetAccount(): Promise<void> {
    if (this.accountReset) return this.accountReset
    this.lifetime.abort()
    this.pendingSend = null
    const closing = this.retire()
    this.state = initialSnapshot()
    this.update(this.settings.reset())
    const task = Promise.allSettled([closing, ...this.retiringHosts, ...this.connectionTasks]).then(results => {
      const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : [])
      if (failures.length) throw new AggregateError(failures, "Account session cleanup failed")
    })
    this.accountReset = task
    void task.then(() => {
      this.lifetime = new AbortController()
      this.accountReset = null
    }, () => { /* Failed cleanup remains a barrier; restarting the Host is required. */ })
    return task
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.lifetime.abort()
    this.disposePromise = this.disposeResources()
    return this.disposePromise
  }

  private async disposeResources(): Promise<void> {
    const current = this.retire()
    const results = await Promise.allSettled(new Set([current, ...this.retiringHosts, this.options.activeConversation?.flush() ?? Promise.resolve()]))
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : [])
    try { if (!failures.length) await this.resources.disposeImages(); else await this.resources.finishImageCleanup() } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, "CodeM host cleanup failed")
  }

  private retire(): Promise<void> {
    const session = this.session
    this.editorGeneration?.release(new UserVisibleError("连接已关闭，生成结果已取消。"))
    this.conversationHistory.reset()
    this.historyList.bind(null)
    this.background.stopPolling()
    const plugins = this.pluginManagement.reset()
    const retiring = Promise.all([plugins, Promise.resolve().then(() => session?.host.close())]).then(() => undefined)
    this.resetResources(false, retiring)
    this.session = null
    this.settings.unbind()
    this.directoryPaths.clear()
    this.generation++
    this.finishActivities("incomplete")
    this.active?.abort.abort()
    this.active = null
    this.unsubscribe?.()
    this.unsubscribe = null
    this.threadId = null
    this.update({ hasOlderMessages: false, historyNeedsRefresh: false })
    // Register every retirement here, including disconnect events, before callers
    // can begin another disposal. Event authority is revoked synchronously above.
    this.retiringHosts.add(retiring)
    const settled = () => { this.retiringHosts.delete(retiring) }
    void retiring.then(settled, settled)
    return retiring
  }

  private onEvent(event: AppServerHostEvent): void {
    if ("threadId" in event && event.threadId === this.threadId && ["turn-started", "turn-completed", "item-started", "item-completed", "thread-cleared", "thread-closed", "thread-status-changed"].includes(event.type)) this.liveSnapshot.invalidate()
    if (event.type === "control-changed" && event.method === "skills/changed" && (event.threadId === null || event.threadId === this.threadId)) {
      this.skillNames.clear()
      this.updateTools({ selectedSkill: null, skills: [], catalog: this.state.sessionTools.catalog?.kind === "skills" ? { ...this.state.sessionTools.catalog, stale: true } : this.state.sessionTools.catalog })
      this.update({ notice: "技能目录已更新，请刷新后重新选择。" })
      return
    }
    const editor = this.editorGeneration
    if (editor?.threadId && "threadId" in event && event.threadId === editor.threadId) {
      if (event.type === "side-question-started" && event.operationId === editor.operationId) { this.acceptEditorSideQuestion(editor, event.sideQuestionId); return }
      if (event.type === "side-question-delta" && event.sideQuestionId === editor.sideQuestionId) { editor.answer += event.delta; return }
      if (event.type === "side-question-completed" && event.sideQuestionId === editor.sideQuestionId) {
        editor.release(editor.cancelled !== null ? new UserVisibleError(editor.cancelled) : event.status === "completed" ? null : new UserVisibleError("生成已取消或失败。"), editor.answer)
        return
      }
      // Core forgets a closed thread together with its side question; the chat handles its own closure below.
      if (event.type === "thread-closed") editor.release(new UserVisibleError("会话已关闭，生成结果已取消。"))
    }
    if ("threadId" in event && event.threadId === this.threadId && this.side) {
      const side = this.side
      if (event.type === "side-question-started" && event.operationId === side.operationId) {
        side.id = event.sideQuestionId
        if (side.status === "starting") side.status = "running"
        this.publishSideQuestion(side)
        return
      }
      if (event.type === "side-question-delta" && event.sideQuestionId === side.id) {
        side.answer += event.delta; this.publishSideQuestion(side)
        return
      }
      if (event.type === "side-question-completed" && event.sideQuestionId === side.id) {
        this.side = null
        side.status = event.status; this.publishSideQuestion(side)
        this.update({ phase: this.active ? "running" : "ready", notice: event.status === "failed" ? "旁路提问失败，请重试。" : null })
        return
      }
    }
    if (event.type === "connection-closed" || event.type === "protocol-error" || event.type === "authentication-invalidated") {
      if (event.type === "authentication-invalidated") this.options.authenticationInvalidated?.()
      const reason = event.type === "protocol-error"
        ? "CORE_PROTOCOL_ERROR：Core 协议处理失败，请更新扩展或查看 CodeM 日志。"
        : event.type === "authentication-invalidated"
          ? "CORE_AUTH_INVALIDATED：CodeM 登录已失效，请重新登录。"
          : `CORE_PROCESS_EXIT：Core 进程已退出（退出码 ${event.exit.code ?? "无"}，信号 ${event.exit.signal ?? "无"}）。请重新连接。`
      this.options.report("connection", new UserVisibleError(reason))
      this.update({ phase: "disconnected", notice: `${reason} 已有记录由 Core 保存。` })
      void this.retire().catch((error) => this.options.report("close", error))
      return
    }
    if (event.type === "turn-started") this.conversationHistory.turnStarted(event.threadId, this.threadId)
    if ("threadId" in event && event.threadId === this.threadId) {
      if (event.type === "thread-modes-updated") {
        this.update(this.settings.acceptModes(event.state))
        return
      }
      if (event.type === "background-wake") {
        this.background.wake(event)
        return
      }
      if (event.type === "turn-started" && event.submissionId === null && !this.active) {
        this.invalidateHistory()
        this.active = { submissionId: randomUUID(), turnId: event.turnId, abort: new AbortController(), finalReplyId: null, finalAnswerCalls: new Set(), toolMessageIds: new Map(), requests: new Map(), approvals: Promise.resolve() }
        this.startTiming(event.turnId, this.active.submissionId)
        this.update({ phase: "running" })
      }
    }
    if (event.type === "warning" && (event.threadId === null || event.threadId === this.threadId)) {
      this.update({ notice: /^context compacted: replaced \d+ earlier messages, kept \d+$/.test(event.message) ? "Core 已整理上下文，正在等待本轮终态；长时间无变化时可停止并重新加载记录。" : "Core 发出了运行警告，请检查当前任务与诊断信息。" })
      return
    }
    if ("threadId" in event && event.threadId === this.threadId) {
      if (event.type === "usage-updated") {
        this.update({ capabilities: { ...this.state.capabilities, usage: { input: event.inputTokens, output: event.outputTokens, cacheRead: event.cacheReadTokens, cacheWrite: event.cacheCreationTokens } } })
        return
      }
      if (event.type === "thread-status-changed") {
        this.update({ capabilities: { ...this.state.capabilities, threadStatus: event.status } })
        return
      }
      if (event.type === "thread-closed" && event.reason !== "unsubscribed") {
        this.conversationHistory.invalidate()
        this.finishActivities("incomplete")
        this.active?.abort.abort(); this.active = null; this.threadId = null
        if (this.session) void this.rememberActiveConversation(this.session, null)
        this.invalidateHistory(); this.resetResources()
        this.update({ attachments: [], diffs: this.state.diffs.map(diff => ({ ...diff, available: false })), background: [], backgroundTasks: [], tools: [], messages: this.state.messages.map(message => message.artifacts ? { ...message, artifacts: message.artifacts.map(artifact => ({ ...artifact, available: false })) } : message), phase: this.mutatingThread ? "configuring" : "ready", notice: "当前会话已关闭或归档。已有内容保留，可从历史列表重新选择会话。" })
        return
      }
      if (event.type === "thread-cleared") {
        this.invalidateHistory()
        this.update({ capabilities: { ...this.state.capabilities, plan: [] }, notice: "Core 已清空会话，请重新加载记录。" })
        return
      }
      if (event.type === "control-changed") {
        this.update({ notice: "Core 会话信息已变化，请刷新历史列表。" })
        return
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
      this.startTiming(event.turnId, active.submissionId)
      this.update({ phase: "running" })
      return
    }
    if (!("turnId" in event) || event.turnId !== active.turnId) return
    if (event.type === "turn-activity") {
      this.update({ capabilities: { ...this.state.capabilities, activity: event.source === "provider_stream" ? "模型正在生成" : "Core 正在处理" } })
    } else if (event.type === "plan-updated") {
      this.update({ capabilities: { ...this.state.capabilities, plan: event.plan.map(step => ({ ...step })) } })
    } else if (event.type === "diff-updated") {
      this.update({ capabilities: { ...this.state.capabilities, changes: event.files.map(file => ({ label: displayPath(this.session!.cwd, file.path), added: file.linesAdded, removed: file.linesRemoved })) } })
    } else if (event.type === "tool-guard") {
      const guard = { id: event.itemId, tool: event.guard.toolName, status: event.guard.status, returnedBytes: event.guard.returnedResultBytes, rawBytes: event.guard.rawResultBytes, capped: event.guard.globalBackstopApplied }
      this.update({ capabilities: { ...this.state.capabilities, guards: [...this.state.capabilities.guards.filter(item => item.id !== guard.id), guard] } })
    } else if (event.type === "hook-completed") {
      this.update({ capabilities: { ...this.state.capabilities, hooks: [...this.state.capabilities.hooks, { id: randomUUID(), event: event.eventName, tool: event.toolName, outcome: event.outcome, elapsedMs: event.elapsedMs }] } })
    } else if (event.type === "file-diff") {
      const row = this.resources.recordDiff(this.session!.cwd, event.turnId, event.itemId, event.diff)
      this.update({ diffs: [...this.state.diffs.filter(diff => diff.id !== row.id), row] })
    } else if (event.type === "item-output-delta") {
      if (active.finalAnswerCalls.has(event.toolCallId)) return
      const id = this.toolMessageId(event.turnId, event.itemId, event.toolCallId)
      this.upsertActivity(id, "tool", null, "running", event.delta, "", true)
    } else if (event.type === "interaction-resolved") {
      active.requests.get(event.requestId)?.abort()
    } else if (event.type === "text-delta" || event.type === "reasoning-delta") {
      const id = `${event.turnId}:${event.itemId}`
      if (event.type === "text-delta") this.upsert(id, "assistant", "CodeM", event.delta, true)
      else this.upsertActivity(id, "reasoning", "思考过程", "running", event.delta, "", true)
    } else if (event.type === "item-started" || event.type === "item-completed") {
      const item = event.item
      if (item.type === "userMessage") return
      if (item.callId && active.finalAnswerCalls.has(item.callId) && item.toolName !== "final_answer") return
      if (item.toolName === "final_answer") {
        if (item.callId) active.finalAnswerCalls.add(item.callId)
        if (item.finalAnswer?.summary) {
          // A structured delivery is a separate Core item, not a replacement for
          // assistant text. Keep both, matching the durable history projection.
          active.finalReplyId = `${event.turnId}:final:${item.id}`
          this.upsert(active.finalReplyId, "assistant", "CodeM", item.finalAnswer.summary, false)
          if (item.finalAnswer.artifacts.length) {
            const previous = this.state.messages.find(message => message.id === active.finalReplyId)
            if (!previous?.artifacts?.length) {
              const artifacts = this.resources.projectArtifacts(item.finalAnswer.artifacts, this.session!.cwd)
              this.update({ messages: this.state.messages.map(message => message.id === active.finalReplyId ? { ...message, artifacts } : message) })
            }
          }
        }
        return
      }
      if (item.type === "agentMessage") {
        this.upsert(`${event.turnId}:${item.id}`, "assistant", "CodeM", item.text || item.output || item.summary, false)
      } else {
        const reasoning = item.type === "reasoning"
        const id = reasoning ? `${event.turnId}:${item.id}` : this.toolMessageId(event.turnId, item.id, item.callId)
        const status: ActivityStatus = item.isError ? "failed" : ({ inProgress: "running", completed: "completed", failed: "failed", declined: "declined", interrupted: "interrupted" } as const)[item.status]
        this.upsertActivity(id, reasoning ? "reasoning" : "tool", reasoning ? "思考过程" : this.toolLabel(item, id), status, item.output || item.text, item.summary, false, reasoning ? undefined : projectToolDetails(this.toolLabel(item, id), item.input, this.session!.cwd) ?? undefined)
      }
    } else if (event.type === "turn-completed") {
      const reload = this.controlTurn === active
      this.controlTurn = null
      if (reload) this.updateTools({ busy: null })
      this.update({ capabilities: { ...this.state.capabilities, activity: null } })
      this.finishActivities(event.outcome === "completed" ? "completed" : event.outcome === "stopped" ? "interrupted" : "failed")
      active.abort.abort()
      this.active = null
      const terminalNotice = event.outcome === "failed" ? reload ? "上下文操作失败，请重试或继续发送消息。" : "本轮任务失败，可以继续发送消息。" : null
      this.update({ phase: "ready", notice: terminalNotice, ...(event.outcome === "stopped" ? { messages: [...this.state.messages, stoppedTurnMessage(event.turnId)] } : {}) })
      if (reload) void this.loadHistoryPage(false, terminalNotice)
    }
  }

  async chooseModel(id: string): Promise<void> {
    const model = this.settings.catalogModel(id)
    if (!this.session || this.state.phase !== "ready" || !model) return
    if (model === this.settings.current().model) return
    await this.configure(async settings => ({ ...settings, model }))
  }

  async chooseSpace(id: string, open: (session: ChatSession, key: string, signal: AbortSignal) => Promise<ChatSession>): Promise<void> {
    const key = this.settings.catalogSpace(id)
    if (!this.session || this.state.phase !== "ready" || !key || key === this.session.space.key) return
    await this.selectSpace((session, signal) => open(session, key, signal))
  }

  async refreshSpaces(): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    this.update({ phase: "configuring", notice: null })
    try {
      this.options.assertTrusted()
      await session.spaceDirectory.refresh(this.lifetime.signal)
      this.options.assertTrusted()
      if (!this.disposed && this.session === session) this.settings.updateSpaces(session.spaceDirectory.list())
    } catch (error) {
      this.options.report("refreshSpaces", error)
      if (!this.disposed && this.session === session) this.update({ notice: "空间列表刷新失败，现有列表保留，请重试。" })
    } finally {
      if (!this.disposed && this.session === session && this.phase() === "configuring") this.update({ phase: "ready" })
    }
  }

  /** Fixed composer choices are local until a connection exists. */
  async setComposerSetting(action: ComposerSettingAction, confirmFullAccess: (signal: AbortSignal) => Promise<boolean> = async () => false): Promise<void> {
    const patch = settingPatch(action)
    if (this.disposed || !["disconnected", "ready"].includes(this.state.phase) || this.state.backgroundBusy || this.state.sessionTools.busy) return
    const session = this.session
    if (patch.permissionMode === "yolo" && this.settings.current().permissionMode !== "yolo") {
      this.options.assertTrusted()
      this.update({ phase: "configuring", notice: null })
      let confirmed = false
      try { confirmed = await confirmFullAccess(this.lifetime.signal) }
      finally { if (!this.disposed && this.session === session && this.state.phase === "configuring") this.update({ phase: session ? "ready" : "disconnected" }) }
      if (!confirmed || this.disposed || this.session !== session) return
    }
    if (session) {
      if (this.settings.unchanged(patch)) { this.publish(); return }
      await this.configure(async settings => ({ ...settings, ...patch }))
      return
    }
    this.update({ phase: "configuring", notice: null, ...this.settings.chooseOffline(patch) })
    const notice = await this.settings.savePending()
    if (!this.disposed) this.update({ phase: "disconnected", ...(notice ? { notice } : {}) })
  }

  /** Host owns the settings transaction. Holding this phase prevents sends racing a selection. */
  async configure(pick: (settings: AppServerThreadSettings, session: ChatSession) => Promise<AppServerThreadSettings | null>): Promise<void> {
    if (this.state.phase === "disconnected") await this.connect()
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    this.update({ phase: "configuring", notice: null })
    try {
      this.options.assertTrusted()
      await this.reclaimThread()
      const modes = this.threadId ? await session.host.readModes(session.cwd, this.threadId) : null
      if (this.session !== session || this.disposed) return
      if (modes) this.update(this.settings.acceptModes(modes))
      const next = await pick(this.settings.draft(), session)
      if (!next || this.session !== session || this.disposed) return
      this.options.assertTrusted()
      const change = this.settings.review(next, modes)
      if (this.active) { this.update({ notice: "后台任务已开始新一轮，请结束后再切换。" }); return }
      let confirmedModes = modes
      if (this.threadId) {
        if (change.resume) {
          await session.host.resumeThread(session.cwd, this.threadId, this.settingsForCore(next))
          if (this.session !== session || this.disposed) return
          this.update(this.settings.acceptResumed(next))
        }
        confirmedModes = modes && change.modes
          ? await session.host.setModes({ cwd: session.cwd, threadId: this.threadId, expectedRevision: modes.revision, ...change.modes })
          : await session.host.readModes(session.cwd, this.threadId)
      }
      if (this.session !== session || this.disposed) return
      this.update({ ...this.settings.commit(next, confirmedModes), tools: [] })
      const notice = await this.settings.persist()
      if (notice && this.session === session && !this.disposed) this.update({ notice })
    } catch (error) {
      if (this.session !== session || this.disposed) return
      this.options.report("configure", error)
      const notice = error instanceof UserVisibleError ? error.message : "设置未应用；已重新读取当前状态，请重试。"
      if (!this.threadId) { this.update({ notice }); return }
      try {
        // A revision conflict is read back, never retried as an unconditional write.
        const modes = await session.host.readModes(session.cwd, this.threadId)
        if (this.session !== session || this.disposed) return
        this.update({ ...this.settings.acceptModes(modes), notice })
      } catch {
        // Failed resume can remove the subscription. Further sends require reconnect.
        if (this.session !== session || this.disposed) return
        this.update({ phase: "disconnected", notice: "设置未能确认，已断开连接。请重新连接后重试。" })
        await this.retire()
      }
    } finally {
      if (this.session === session && !this.disposed && this.phase() === "configuring") this.update({ phase: "ready" })
    }
  }

  async openArtifact(id: string, open: (source: ArtifactSource) => Promise<void>): Promise<void> {
    const session = this.session
    if (!session || this.disposed || !this.state.messages.some(message => message.artifacts?.some(artifact => artifact.id === id))) return
    this.options.assertTrusted()
    const source = await this.resources.resolveArtifact(session.cwd, id)
    this.options.assertTrusted()
    if (this.session !== session || !this.state.messages.some(message => message.artifacts?.some(artifact => artifact.id === id))) return
    await open(source)
  }

  async loadImage(id: string): Promise<AttachmentView["preview"]> {
    const session = this.session
    const visible = () => this.state.attachments.some(item => item.id === id) || this.state.messages.some(message => "attachments" in message && message.attachments?.some(item => item.id === id))
    if (this.disposed || !visible()) return { kind: "unavailable", reason: "图片引用已过期。" }
    this.options.assertTrusted()
    try {
      const preview = await this.resources.loadImage(id)
      this.options.assertTrusted()
      if (session !== this.session || !visible() || this.disposed) throw new Error("Image no longer belongs to current view")
      return preview
    } catch { return { kind: "unavailable", reason: "图片无法读取，可能已移除、发生变化或超过 20 MiB。" } }
  }

  async searchFiles(query: string, find: (cwd: string, query: string) => Promise<readonly string[]>) {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready") return []
    this.options.assertTrusted()
    const files = await this.resources.search(session.cwd, query, find)
    this.options.assertTrusted()
    return this.session === session && this.state.phase === "ready" && !this.disposed ? files : []
  }

  async selectFile(id: string): Promise<boolean> {
    const session = this.session
    if (!session || this.state.phase !== "ready" || this.disposed) return false
    this.options.assertTrusted()
    const item = await this.resources.resolveFile(session.cwd, id)
    if (this.session !== session) return false
    await this.addAttachments(async () => [item])
    return this.session === session && this.resources.selected().some(value => value.path === item.path)
  }

  async pasteImages(action: PasteImagesAction): Promise<string | null> {
    const session = this.session
    const generation = this.generation
    if (this.disposed || action.scope !== attachmentScope({ ...this.state, threadId: this.threadId })) return "会话已切换，请重新粘贴图片。"
    if (!["ready", "disconnected"].includes(this.state.phase) || this.state.backgroundBusy || this.state.sessionTools.busy) return "请等待当前操作完成后再粘贴图片。"
    const assertCurrent = () => {
      this.options.assertTrusted()
      if (this.disposed || this.session !== session || this.generation !== generation || action.scope !== attachmentScope({ ...this.state, threadId: this.threadId })) throw new Error("Image paste expired")
    }
    let additions: AttachmentView[] = []
    this.update({ phase: "configuring", notice: null })
    try {
      assertCurrent()
      additions = await this.resources.addPastedImages(action.images, assertCurrent)
      assertCurrent()
      this.update({ attachments: [...this.state.attachments, ...additions] })
      return null
    } catch (error) {
      for (const item of additions) this.resources.remove(item.id)
      this.options.report("pasteImages", error)
      return error instanceof UserVisibleError ? error.message : "图片粘贴失败，请重新复制后重试。"
    } finally {
      if (this.session === session && this.generation === generation && !this.disposed && this.phase() === "configuring") this.update({ phase: session ? "ready" : "disconnected" })
    }
  }

  async addAttachments(pick: () => Promise<readonly AppServerPromptAttachment[]>): Promise<void> {
    const session = this.session
    if (this.disposed || !["ready", "disconnected"].includes(this.state.phase) || this.state.backgroundBusy || this.state.sessionTools.busy) return
    this.update({ phase: "configuring", notice: null })
    try {
      this.options.assertTrusted()
      const chosen = await pick()
      if (this.session !== session || this.disposed) return
      this.options.assertTrusted()
      const additions = await this.resources.add(session?.cwd ?? null, chosen, () => {
        this.options.assertTrusted()
        if (this.session !== session || this.disposed) throw new Error("Attachment selection expired")
      })
      if (this.session !== session || this.disposed) return
      this.options.assertTrusted()
      this.update({ attachments: [...this.state.attachments, ...additions] })
    } catch (error) {
      this.options.report("attachment", error)
      if (this.session === session) this.update({ notice: error instanceof UserVisibleError ? error.message : "附件不可用，请检查文件是否存在；图片不能超过 20 MiB。" })
    } finally {
      if (this.session === session && this.phase() === "configuring") this.update({ phase: session ? "ready" : "disconnected" })
    }
  }

  removeAttachment(id: string): void {
    if (!["ready", "disconnected"].includes(this.state.phase)) return
    this.resources.remove(id)
    this.update({ attachments: this.state.attachments.filter((item) => item.id !== id) })
  }

  async showDiff(id: string, show: (diff: FileDiffContent, cwd: string) => Promise<void>): Promise<void> {
    const diff = this.resources.diff(id)
    if (!this.session || !diff || this.disposed) return
    this.options.assertTrusted()
    await show(diff, this.session.cwd)
  }

  async refreshTools(): Promise<void> {
    await this.loadCatalog("tools")
  }

  private backgroundContext(): BackgroundContext | null {
    if (!this.session || !this.threadId || this.disposed || this.state.phase === "configuring" || this.state.phase === "loadingHistory") return null
    return { host: this.session.host, cwd: this.session.cwd, threadId: this.threadId }
  }

  async refreshBackground(): Promise<void> {
    const context = this.backgroundContext()
    if (context) await this.background.refresh(context)
  }
  async terminateBackground(id: string): Promise<void> {
    const context = this.backgroundContext()
    if (context) await this.background.terminate(context, id)
  }
  async cleanBackground(): Promise<void> {
    const context = this.backgroundContext()
    if (context) await this.background.clean(context)
  }
  async cancelTask(id: string): Promise<void> {
    const context = this.backgroundContext()
    if (context) await this.background.cancel(context, id)
  }
  async showBackgroundLog(id: string, show: (path: string) => Promise<void>): Promise<void> {
    if (this.session && !this.disposed) await this.background.showLog(id, show)
  }

  private resetResources(preserveAttachments = false, releaseAfter: Promise<unknown> = Promise.resolve()): void {
    this.conversationSearch.reset()
    this.liveSnapshot.clear()
    this.side = null; this.controlTurn = null; this.skillNames.clear()
    this.state = { ...this.state, capabilities: emptyCapabilities(), sessionTools: { ...emptySessionTools(), directories: this.state.sessionTools.directories } }
    this.resources.clear(preserveAttachments, releaseAfter); this.background.clear()
    this.state = { ...this.state, ...this.background.snapshot() }
  }

  private async respond(request: AppServerInteraction, active: ActiveTurn, abort: AbortController): Promise<void> {
    const session = this.session
    if (!session || this.active !== active || abort.signal.aborted) return
    const cancel = () => abort.abort()
    active.abort.signal.addEventListener("abort", cancel, { once: true })
    try {
      const response = await this.options.interact(request, abort.signal, session.cwd)
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

  private toolMessageId(turnId: string, itemId: string, callId: string | null): string {
    const ids = this.active!.toolMessageIds
    const itemKey = `item:${itemId}`
    const callKey = callId === null ? null : `call:${callId}`
    const id = (callKey ? ids.get(callKey) : undefined) ?? ids.get(itemKey) ?? `${turnId}:tool:${itemId}`
    ids.set(itemKey, id)
    if (callKey) ids.set(callKey, id)
    return id
  }

  private toolLabel(item: AppServerItem, id: string): string {
    if (item.toolName) return item.type === "mcpToolCall" ? `MCP · ${item.toolName}` : item.toolName
    const previous = this.state.messages.find((message) => message.id === id)
    if (previous) return previous.label
    return { commandExecution: "执行命令", fileChange: "修改文件", mcpToolCall: "调用工具", webSearch: "搜索", contextCompaction: "整理上下文", toolCall: "调用工具", toolResult: "工具结果", subagent: "子任务", reasoning: "思考过程", agentMessage: "回复", userMessage: "消息" }[item.type]
  }

  private upsertActivity(id: string, role: ActivityMessage["role"], label: string | null, status: ActivityStatus, text: string, summary: string, append: boolean, details?: ToolDetails): void {
    const existing = this.state.messages.find((message) => message.id === id)
    const previous = existing && "status" in existing ? existing : undefined
    const message: ActivityMessage = {
      ...previous, ...(details ? { details } : {}),
      id, role, turnId: this.active?.turnId ?? undefined, label: label ?? previous?.label ?? "工具输出",
      // Late progress cannot revert a terminal item to running.
      status: status === "running" && previous && previous.status !== "running" ? previous.status : status,
      text: append ? (previous?.text ?? "") + text : text || previous?.text || "",
      summary: summary || previous?.summary || "",
    }
    this.update({ messages: terminalReplyLast(previous ? this.state.messages.map((item) => item.id === id ? message : item) : [...this.state.messages, message], this.active?.finalReplyId ?? null) })
  }

  private startTiming(turnId: string, submissionId: string): void {
    if (this.state.turnTimings.some(timing => timing.turnId === turnId)) return
    this.update({
      turnTimings: [...this.state.turnTimings, { turnId, startedAt: Date.now(), finishedAt: null }],
      messages: this.state.messages.map(message => message.id === submissionId ? { ...message, turnId } : message),
    })
  }

  private finishActivities(status: "completed" | "failed" | "interrupted" | "incomplete"): void {
    const turnId = this.active?.turnId
    if (!turnId) return
    this.update({ turnTimings: this.state.turnTimings.map(timing => timing.turnId === turnId && timing.finishedAt === null ? { ...timing, finishedAt: Math.max(timing.startedAt, Date.now()) } : timing), messages: this.state.messages.map((message) => {
      if (!("status" in message) || message.status !== "running" || !message.id.startsWith(`${turnId}:`)) return message
      // Turn success is not evidence that a tool with a missing result succeeded.
      return { ...message, status: status === "completed" && message.role === "tool" ? "incomplete" : status }
    }) })
  }

  private upsert(id: string, role: "user" | "assistant", label: string, text: string, append: boolean): void {
    const previous = this.state.messages.find((message) => message.id === id)
    const message = { ...previous, id, role, turnId: this.active?.turnId ?? undefined, label, text: append ? (previous?.text ?? "") + text : text || previous?.text || "" }
    this.update({ messages: terminalReplyLast(previous ? this.state.messages.map((item) => item.id === id ? message : item) : [...this.state.messages, message], this.active?.finalReplyId ?? null) })
  }

  private update(patch: Partial<ChatSnapshot>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    this.resources.retainImages(this.state.attachments, this.state.messages)
    this.publish()
  }
}
