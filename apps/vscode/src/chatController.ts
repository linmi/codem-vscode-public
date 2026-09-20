import { realpath, stat } from "node:fs/promises"
import { basename } from "node:path"
import { projectCatalog } from "./capabilityCatalog.ts"
import { emptySessionTools, type CatalogKind, type ThreadOperation, type SessionToolsState, emptyCapabilities } from "./capabilityTypes.ts"
import type { SpaceDirectory } from "./spaceDirectory.ts"
import type { SettingsPersistence } from "./connectionPreferences.ts"
import { projectToolDetails } from "./toolDetails.ts"
import { Artifacts, type ArtifactSource } from "./artifacts.ts"
import { FileReferences } from "./fileReferences.ts"
import { readSessionImage, resolveSessionsRoot, type ConversationAttachment, type SessionHistoryPage } from "@codem/session-history"
import { changedFilePath } from "./filePresentation.ts"
import { attachmentPreview, rasterPreview } from "./attachmentPreview.ts"
import { terminalReplyLast } from "./timelineOrder.ts"
import { randomUUID } from "node:crypto"
import { APP_SERVER_BUILTIN_INTELLIGENCE_TIERS, type AppServerItem, type AppServerThreadSettings, type AppServerModelSummary, type AppServerPromptAttachment, type AppServerFileDiff, type AppServerBackgroundTerminal, DEFAULT_APP_SERVER_THREAD_SETTINGS, type AppServerHost, type AppServerHostEvent, type AppServerInteraction, type AppServerInteractionResponse } from "@codem/app-server"
import { initialSnapshot, isBusy, type ToolDetails, type AttachmentView, type ActivityMessage, type ActivityStatus, type ChatSnapshot } from "./messages.ts"

import { HistoryListController } from "./historyList.ts"
import { historyMessages, historyTurnTimings } from "./historyMessages.ts"
import type { SessionHistoryReader } from "./sessionHistory.ts"

import { displayPath, validateAttachment } from "./filePresentation.ts"

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
export class UserVisibleError extends Error {}
export interface ChatControllerOptions {
  preferences?: SettingsPersistence
  connected?: (session: ChatSession) => Promise<void>

  connect: (signIn: boolean, signal: AbortSignal) => Promise<ChatSession>
  assertTrusted: () => void
  publish: (state: ChatSnapshot) => void
  interact: (request: AppServerInteraction, signal: AbortSignal, cwd: string) => Promise<AppServerInteractionResponse | null>
  report: (operation: string, error: unknown) => void
}

/** One live conversation. Core owns durable history; these are display-only snapshots. */
export class ChatController {
  private side: { operationId: string; id: string | null } | null = null
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
  private readonly lifetime = new AbortController()
  private state: ChatSnapshot = initialSnapshot()
  private settings: AppServerThreadSettings = { ...DEFAULT_APP_SERVER_THREAD_SETTINGS, permissionMode: "default" }
  private readonly artifacts = new Artifacts()
  private readonly images = new Map<string, () => Promise<AttachmentView["preview"]>>()
  private readonly references = new FileReferences()
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
      const restored = await this.restoreSettings(session)
      if (this.disposed || generation !== this.generation) { await session.host.close(); return }
      this.options.assertTrusted()
      this.bindSession(session, generation, restored)
      await this.rememberConnection(session)
    } catch (error) {
      if (acquired && this.session !== acquired) await acquired.host.close()
      if (!this.disposed && generation === this.generation) {
        this.options.report("connect", error)
        this.update({ phase: "disconnected", notice: error instanceof UserVisibleError ? error.message : "连接失败，请查看 CodeM 日志后重试。" })
      }
    }
  }

  private bindSession(session: ChatSession, generation: number, restored: { settings: AppServerThreadSettings; notice: string | null }): void {
    this.session = session
    this.historyList.bind({ host: session.host, cwd: session.cwd, authorize: async () => { this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted() } })
    this.historyCursor = null
    this.threadId = null
    this.resetResources()
    this.settings = restored.settings
    this.directoryPaths.clear()
    this.unsubscribe = session.host.onEvent((event) => {
      if (this.session === session && generation === this.generation) this.onEvent(event)
    })
    this.update({ ...initialSnapshot(), phase: "ready", workspace: session.workspace, space: session.space.name, model: this.settings.model, effort: this.settings.intelligence, permission: this.settings.permissionMode, workMode: this.settings.workMode, mcpNames: this.settings.mcpServers.map((server) => server.name), notice: restored.notice })
    this.poll = setInterval(() => { void this.refreshBackground() }, 3000)
    this.poll.unref()
  }

  private async rememberConnection(session: ChatSession): Promise<void> {
    try { await this.options.connected?.(session) }
    catch (error) {
      this.options.report("saveConnection", error)
      if (!this.disposed && this.session === session) this.update({ notice: "已连接，但工作区和空间选择保存失败；重载后需要重新选择。" })
    }
  }

  private async restoreSettings(session: ChatSession): Promise<{ settings: AppServerThreadSettings; notice: string | null }> {
    const saved = await this.options.preferences?.load(session)
    const available = !saved || session.models.some(model => model.id === saved.model)
    return {
      settings: { ...DEFAULT_APP_SERVER_THREAD_SETTINGS, permissionMode: "default", ...saved, model: available && saved ? saved.model : session.model, mcpServers: session.mcpServers },
      notice: available ? null : "已保存的模型当前不可用，暂用 Core 当前模型；原选择仍保留，可重新选择模型。",
    }
  }

  async selectSpace(pick: (session: ChatSession, signal: AbortSignal) => Promise<ChatSession | null>): Promise<void> {
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
      const restored = await this.restoreSettings(next)
      if (this.disposed || this.session !== previous || this.active) { await next.host.close(); next = null; return }
      this.options.assertTrusted()
      const retiring = this.retire()
      void retiring.catch(error => this.options.report("retireSpace", error))
      this.bindSession(next, this.generation, restored)
      const connected = next
      next = null
      await this.rememberConnection(connected)
    } catch (error) {
      if (next) await next.host.close()
      this.options.report("selectSpace", error)
      if (!this.disposed) this.update({ notice: "空间切换失败，请重试或查看 CodeM 日志。" })
    } finally {
      if (!this.disposed && this.snapshot().phase === "configuring") this.update({ phase: this.session ? "ready" : "disconnected" })
    }
  }

  async send(text: string): Promise<boolean> {
    if (this.disposed || this.state.phase !== "ready" || !this.session || this.state.sessionTools.busy) return false
    if (!text.trim() || text.length > 32_000) return false
    const session = this.session
    const active: ActiveTurn = { submissionId: randomUUID(), turnId: null, abort: new AbortController(), finalReplyId: null, finalAnswerCalls: new Set(), toolMessageIds: new Map(), requests: new Map(), approvals: Promise.resolve() }
    const attachmentIds = [...this.attachments.keys()]
    const consumeAttachments = () => {
      if (this.session !== session || this.disposed) return
      for (const id of attachmentIds) this.attachments.delete(id)
      this.updateTools({ selectedSkill: null })
      this.update({ attachments: this.state.attachments.filter((item) => !attachmentIds.includes(item.id)) })
    }
    this.active = active
    this.invalidateHistory()
    this.update({ phase: "sending", notice: null, capabilities: { ...this.state.capabilities, plan: [], changes: [], guards: [], hooks: [] } })
    try {
      this.options.assertTrusted()
      for (const attachment of this.attachments.values()) await validateAttachment(attachment)
      if ([...this.attachments.values()].some((attachment) => attachment.kind === "image") && !session.models.find((model) => model.id === this.settings.model)?.supportsVision) throw new UserVisibleError("当前模型不支持图片，请切换模型或移除图片。")
      if (!this.threadId) {
        const threadId = await session.host.startThread(session.cwd, this.settings)
        if (this.session !== session || this.disposed) return false
        this.threadId = threadId
      }
      this.options.assertTrusted()
      const attachments = [...this.attachments.values()]
      this.update({ messages: [...this.state.messages, { id: active.submissionId, role: "user", label: "你", text, ...(this.state.attachments.length ? { attachments: this.state.attachments } : {}) }] })
      const skillId = this.state.sessionTools.selectedSkill
      const skillName = skillId === null ? undefined : this.skillNames.get(skillId)
      if (skillId !== null && !skillName) throw new UserVisibleError("技能目录已变化，请重新选择技能。")
      if (skillName && attachments.length) throw new UserVisibleError("技能输入暂不支持附件，请先移除附件。")
      const turnId = await session.host.startTurn({ cwd: session.cwd, threadId: this.threadId, submissionId: active.submissionId, text, attachments, ...(skillName ? { skillName } : {}) })
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

  async loadCatalog(kind: CatalogKind): Promise<void> {
    const session = this.session
    const threadId = this.threadId
    if (!session || this.disposed || this.state.sessionTools.busy || !["ready", "running"].includes(this.state.phase)) return
    this.updateTools({ busy: `catalog:${kind}` })
    try {
      this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted()
      if (this.session !== session || this.threadId !== threadId) return
      if (kind === "skills") {
        const skills = await session.host.listSkills(session.cwd, threadId ?? undefined)
        if (this.session !== session || this.threadId !== threadId) return
        const previous = new Map([...this.skillNames].map(([id, name]) => [name, id]))
        this.skillNames.clear()
        const rows = skills.map(skill => { const id = previous.get(skill.name) ?? randomUUID(); this.skillNames.set(id, skill.name); return { id, name: skill.name, description: skill.description } })
        const selected = this.state.sessionTools.selectedSkill
        this.updateTools({ skills: rows, selectedSkill: selected && this.skillNames.has(selected) ? selected : null, catalog: { kind, loaded: true, stale: false, rows: rows.map(skill => ({ label: skill.name, detail: skill.description })) } })
      } else {
        const rows = await projectCatalog(session.host, session.cwd, threadId, kind)
        if (this.session !== session || this.threadId !== threadId) return
        this.updateTools({ catalog: { kind, rows, loaded: true, stale: false } })
      }
    } catch (error) {
      this.options.report("catalog", error)
      if (this.session === session && this.threadId === threadId) this.update({ notice: "目录读取失败，已有结果保留；请刷新重试。" })
    } finally { if (this.session === session && this.threadId === threadId) this.updateTools({ busy: null }) }
  }

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
    const side = { operationId: requestId, id: null as string | null }
    this.side = side
    this.update({ phase: "sideQuestion", notice: null })
    this.updateTools({ sideQuestion: { question: text, answer: "", status: "starting" }, result: null })
    try {
      this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted()
      if (this.session !== session || this.side !== side) return
      const id = await session.host.startSideQuestion(session.cwd, threadId, requestId, text)
      if (this.session !== session || this.threadId !== threadId) return
      if (this.side === side) { side.id = id; this.updateTools({ sideQuestion: { ...this.state.sessionTools.sideQuestion!, status: "running" } }) }
      this.updateTools({ result: { requestId, accepted: true } })
    } catch (error) {
      this.options.report("sideQuestion", error)
      if (this.session !== session || this.threadId !== threadId) return
      if (this.side === side && side.id === null) { this.side = null; this.update({ phase: "ready" }); this.updateTools({ sideQuestion: { question: text, answer: "", status: "failed" } }) }
      this.updateTools({ result: { requestId, accepted: side.id !== null } })
      this.update({ notice: "旁路提问回执未能确认；内容保留，不自动重试。" })
    }
  }

  async cancelSideQuestion(): Promise<void> {
    const session = this.session, side = this.side, threadId = this.threadId
    if (!session || !side?.id || !threadId || this.state.sessionTools.sideQuestion?.status !== "running") return
    this.updateTools({ sideQuestion: { ...this.state.sessionTools.sideQuestion, status: "stopping" } })
    try { this.options.assertTrusted(); await session.host.cancelSideQuestion(session.cwd, threadId, side.id) }
    catch (error) {
      this.options.report("cancelSideQuestion", error)
      if (this.side === side) { this.updateTools({ sideQuestion: { ...this.state.sessionTools.sideQuestion!, status: "running" } }); this.update({ notice: "取消失败，请重试。" }) }
    }
  }

  async startControl(kind: "compact" | "rewind", requestId: string): Promise<void> {
    const session = this.session, threadId = this.threadId
    if (!session || !threadId || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    const active: ActiveTurn = { submissionId: requestId, turnId: null, abort: new AbortController(), finalReplyId: null, finalAnswerCalls: new Set(), toolMessageIds: new Map(), requests: new Map(), approvals: Promise.resolve() }
    this.active = active; this.controlTurn = active
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
      if (this.active === active && active.turnId === null) { this.active = null; this.controlTurn = null; active.abort.abort(); this.update({ phase: "ready" }) }
      this.update({ notice: "操作未能确认，已有记录保留；请检查当前状态后重试。" })
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
      this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted()
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
        const modes = await session.host.readModes(session.cwd, id)
        if (this.session !== session || this.threadId !== id) return
        this.settings = { ...this.settings, permissionMode: modes.permissionMode, workMode: modes.workMode === "plan" ? "plan" : "default" }; this.updateSettings()
        this.update({ messages: [], turnTimings: [], diffs: [], attachments: [], background: [], backgroundTasks: [], tools: [], historyNeedsRefresh: false })
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
        this.update({ notice: written ? "操作已提交，但结果刷新失败；请刷新历史列表。" : "操作未能确认，未自动重试；请刷新历史列表核对后再操作。" })
      }
    } finally {
      this.mutatingThread = false
      if (this.session === session) { this.updateTools({ busy: null }); if (this.snapshot().phase === "configuring") this.update({ phase: "ready" }) }
    }
  }

  async shellCommand(command: string, requestId: string): Promise<void> {
    const session = this.session, threadId = this.threadId
    if (!session || !threadId || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    this.update({ phase: "configuring", notice: null }); this.updateTools({ busy: "shell", result: null })
    try {
      this.options.assertTrusted(); await session.authorize(); this.options.assertTrusted()
      if (this.session !== session || this.threadId !== threadId || this.active) return
      await session.host.runShellCommand(session.cwd, threadId, command)
      if (this.session !== session || this.threadId !== threadId) return
      this.updateTools({ result: { requestId, accepted: true } })
      this.update({ notice: "命令已提交；此操作不提供输出预览，可检查文件或后台日志。" })
    } catch (error) {
      this.options.report("shellCommand", error)
      if (this.session === session && this.threadId === threadId) { this.updateTools({ result: { requestId, accepted: false } }); this.update({ notice: "命令未能确认，请核对执行结果后再重试。" }) }
    } finally {
      if (this.session === session && this.threadId === threadId) { this.updateTools({ busy: null }); if (this.snapshot().phase === "configuring") this.update({ phase: "ready" }) }
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
    const directories = this.settings.additionalDirectories.map(path => { const id = previous.get(path) ?? randomUUID(); this.directoryPaths.set(id, path); return { id, label: basename(path) } })
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
    this.update({ hasOlderMessages: false, historyNeedsRefresh: false, messages: [], turnTimings: [], attachments: [], diffs: [], background: [], backgroundTasks: [], tools: [], notice: null, phase: this.session ? "ready" : "disconnected" })
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
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
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
      if (previousThreadId) {
        releasingPrevious = true
        await session.host.unsubscribeThread(session.cwd, previousThreadId)
        this.assertHistoryContext(session, abort)
      }
      this.threadId = threadId
      this.historyCursor = page.nextCursor
      this.resetResources()
      const messages = this.projectHistory(threadId, page, session)
      this.settings = { ...this.settings, permissionMode: modes.permissionMode, workMode: modes.workMode === "plan" ? "plan" : "default" }
      this.update({ phase: "ready", messages, turnTimings: historyTurnTimings(page), permission: this.settings.permissionMode, workMode: this.settings.workMode, attachments: [], diffs: [], background: [], backgroundTasks: [], tools: [], hasOlderMessages: page.nextCursor !== null, historyNeedsRefresh: false, notice: null })
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
    if (!session || !threadId || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
    if (this.historyRead) { this.update({ notice: "正在结束上一次历史读取，请稍后重试。" }); return }
    const cursor = append ? this.historyCursor ?? undefined : undefined
    const abort = new AbortController()
    this.historyRead = abort
    this.update({ phase: "loadingHistory", notice: null })
    try {
      this.options.assertTrusted()
      const page = await session.readHistory(threadId, cursor, abort.signal)
      this.assertHistoryContext(session, abort)
      const messages = this.projectHistory(threadId, page, session)
      if (append && (page.nextCursor === cursor || messages.some((message) => this.state.messages.some((old) => old.id === message.id)))) throw new Error("History page overlaps the current snapshot")
      this.historyCursor = page.nextCursor
      this.update({ messages: append ? [...messages, ...this.state.messages] : messages, turnTimings: append ? [...historyTurnTimings(page), ...this.state.turnTimings] : historyTurnTimings(page), hasOlderMessages: page.nextCursor !== null, historyNeedsRefresh: false })
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

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.lifetime.abort()
    this.disposePromise = this.disposeResources()
    return this.disposePromise
  }

  private async disposeResources(): Promise<void> {
    const current = this.retire()
    const results = await Promise.allSettled(new Set([current, ...this.retiringHosts]))
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : [])
    if (failures.length) throw new AggregateError(failures, "CodeM host cleanup failed")
  }

  private retire(): Promise<void> {
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
    const retiring = Promise.resolve().then(() => session?.host.close())
    this.retiringHosts.add(retiring)
    const settled = () => { this.retiringHosts.delete(retiring) }
    void retiring.then(settled, settled)
    return retiring
  }

  private onEvent(event: AppServerHostEvent): void {
    if (event.type === "control-changed" && event.method === "skills/changed" && (event.threadId === null || event.threadId === this.threadId)) {
      this.skillNames.clear()
      this.updateTools({ selectedSkill: null, skills: [], catalog: this.state.sessionTools.catalog ? { ...this.state.sessionTools.catalog, stale: true } : null })
      this.update({ notice: "技能目录已更新，请刷新后重新选择。" })
      return
    }
    if ("threadId" in event && event.threadId === this.threadId && this.side) {
      const side = this.side
      if (event.type === "side-question-started" && event.operationId === side.operationId) {
        side.id = event.sideQuestionId
        this.updateTools({ sideQuestion: { question: event.question, answer: "", status: "running" } })
        return
      }
      if (event.type === "side-question-delta" && event.sideQuestionId === side.id) {
        this.updateTools({ sideQuestion: { ...this.state.sessionTools.sideQuestion!, answer: this.state.sessionTools.sideQuestion!.answer + event.delta } })
        return
      }
      if (event.type === "side-question-completed" && event.sideQuestionId === side.id) {
        this.side = null
        this.updateTools({ sideQuestion: { ...this.state.sessionTools.sideQuestion!, status: event.status } })
        this.update({ phase: this.active ? "running" : "ready", notice: event.status === "failed" ? "旁路提问失败，请重试。" : null })
        return
      }
    }
    if (event.type === "connection-closed" || event.type === "protocol-error" || event.type === "authentication-invalidated") {
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
        this.historyRead?.abort()
        this.finishActivities("incomplete")
        this.active?.abort.abort(); this.active = null; this.threadId = null
        this.invalidateHistory(); this.resetResources()
        this.update({ attachments: [], diffs: [], background: [], backgroundTasks: [], tools: [], messages: this.state.messages.map(message => message.artifacts ? { ...message, artifacts: message.artifacts.map(artifact => ({ ...artifact, available: false })) } : message), phase: this.mutatingThread ? "configuring" : "ready", notice: "当前会话已关闭或归档。已有内容保留，可从历史列表重新选择会话。" })
        return
      }
      if (event.type === "thread-cleared") {
        this.invalidateHistory()
        this.update({ notice: "Core 已清空会话，请重新加载记录。" })
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
      const id = randomUUID()
      this.diffs.set(id, event.diff)
      const messageId = this.toolMessageId(event.turnId, event.diff.source.toolCallId, event.diff.source.toolCallId)
      if (!this.state.messages.some(message => message.id === messageId)) this.upsertActivity(messageId, "tool", "修改文件", "running", "", "", false)
      this.update({ messages: this.state.messages.map(message => message.id === messageId ? { ...message, artifacts: [...message.artifacts ?? [], { id, kind: "diff" as const, title: displayPath(this.session!.cwd, event.diff.path), detail: `+${event.diff.stats.linesAdded} −${event.diff.stats.linesRemoved} · ${event.diff.preview.kind}`, available: true }] } : message) })
      this.update({ diffs: [...this.state.diffs, { id, label: displayPath(this.session!.cwd, event.diff.path), added: event.diff.stats.linesAdded, removed: event.diff.stats.linesRemoved, preview: event.diff.preview.kind }] })
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
              const artifacts = this.artifacts.project(item.finalAnswer.artifacts, this.session!.cwd)
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
      this.update({ capabilities: { ...this.state.capabilities, activity: null } })
      this.finishActivities(event.outcome === "completed" ? "completed" : event.outcome === "stopped" ? "interrupted" : "failed")
      active.abort.abort()
      this.active = null
      this.update({ phase: "ready", notice: event.outcome === "completed" ? null : event.outcome === "stopped" ? "已停止生成。" : "本轮任务失败，可以继续发送消息。" })
      if (reload) void this.reloadHistory()
    }
  }

  /** Host owns the settings transaction. Holding this phase prevents sends racing a selection. */
  async configure(pick: (settings: AppServerThreadSettings, session: ChatSession) => Promise<AppServerThreadSettings | null>): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
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
        if (next.model !== this.settings.model || next.intelligence !== this.settings.intelligence || JSON.stringify(next.additionalDirectories) !== JSON.stringify(this.settings.additionalDirectories) || JSON.stringify(next.mcpServers) !== JSON.stringify(this.settings.mcpServers)) {
          await session.host.resumeThread(session.cwd, this.threadId, next)
          if (this.session !== session || this.disposed) return
          this.settings = { ...this.settings, model: next.model, intelligence: next.intelligence, additionalDirectories: next.additionalDirectories, mcpServers: next.mcpServers }
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
      try { await this.options.preferences?.save(session, this.settings) }
      catch (error) {
        this.options.report("saveSettings", error)
        if (this.session === session && !this.disposed) this.update({ notice: "配置已应用，但保存失败；重载后可能无法恢复，请重新选择后重试。" })
      }
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

  private projectHistory(threadId: string, page: SessionHistoryPage, session: ChatSession) {
    return historyMessages(threadId, page, (item: ConversationAttachment): AttachmentView => {
      const id = randomUUID()
      const kind = item.kind === "session-image" ? "image" : item.kind
      if (kind === "image") this.images.set(id, async () => {
        if (item.kind === "session-image") {
          const bytes = await readSessionImage({ sessionsRoot: resolveSessionsRoot(process.env), cwd: session.cwd, threadId, attachment: item })
          const preview = rasterPreview(bytes)
          if (preview.kind !== "image" || !preview.dataUrl.startsWith(`data:${item.mediaType};`)) throw new Error("Image media type mismatch")
          return preview
        }
        return attachmentPreview({ kind: "image", path: await changedFilePath(session.cwd, item.path) })
      })
      return { id, label: item.kind === "session-image" ? item.displayName : displayPath(session.cwd, item.path), kind, preview: kind === "image" ? { kind: "deferred" } : { kind: "none" } }
    }, items => this.artifacts.project(items, session.cwd), session.cwd)
  }

  async openArtifact(id: string, open: (source: ArtifactSource) => Promise<void>): Promise<void> {
    const session = this.session
    if (!session || this.disposed || !this.state.messages.some(message => message.artifacts?.some(artifact => artifact.id === id))) return
    this.options.assertTrusted()
    const source = await this.artifacts.resolve(session.cwd, id)
    this.options.assertTrusted()
    if (this.session !== session || !this.state.messages.some(message => message.artifacts?.some(artifact => artifact.id === id))) return
    await open(source)
  }

  async loadImage(id: string): Promise<AttachmentView["preview"]> {
    const session = this.session
    const visible = () => this.state.attachments.some(item => item.id === id) || this.state.messages.some(message => "attachments" in message && message.attachments?.some(item => item.id === id))
    if (!session || this.disposed || !visible()) return { kind: "unavailable", reason: "图片引用已过期。" }
    this.options.assertTrusted()
    try {
      const load = this.images.get(id)
      if (!load) throw new Error("Unknown image")
      const preview = await load()
      this.options.assertTrusted()
      if (session !== this.session || !visible() || this.disposed) throw new Error("Image no longer belongs to current view")
      return preview
    } catch { return { kind: "unavailable", reason: "图片无法读取，可能已移除、发生变化或超过 20 MiB。" } }
  }

  async searchFiles(query: string, find: (cwd: string, query: string) => Promise<readonly string[]>) {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready") return []
    this.options.assertTrusted()
    const files = await this.references.search(session.cwd, query, find)
    this.options.assertTrusted()
    return this.session === session && this.state.phase === "ready" && !this.disposed ? files : []
  }

  async selectFile(id: string): Promise<boolean> {
    const session = this.session
    if (!session || this.state.phase !== "ready" || this.disposed) return false
    this.options.assertTrusted()
    const item = await this.references.resolve(session.cwd, id)
    if (this.session !== session) return false
    await this.addAttachments(async () => [item])
    return this.session === session && [...this.attachments.values()].some(value => value.path === item.path)
  }

  async addAttachments(pick: () => Promise<readonly AppServerPromptAttachment[]>): Promise<void> {
    const session = this.session
    if (!session || this.disposed || this.state.phase !== "ready" || this.state.backgroundBusy || this.state.sessionTools.busy) return
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
      const additions = await Promise.all(unique.map(async item => ({ id: randomUUID(), item, preview: item.kind === "image" ? { kind: "deferred" as const } : { kind: "none" as const } })))
      if (this.session !== session || this.disposed) return
      this.options.assertTrusted()
      for (const { id, item } of additions) { this.attachments.set(id, item); if (item.kind === "image") this.images.set(id, () => attachmentPreview(item)) }
      this.update({ attachments: [...this.state.attachments, ...additions.map(({ id, item, preview }) => ({ id, label: displayPath(session.cwd, item.path), kind: item.kind, preview }))] })
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
    this.side = null; this.controlTurn = null; this.skillNames.clear()
    this.state = { ...this.state, capabilities: emptyCapabilities(), sessionTools: { ...emptySessionTools(), directories: this.state.sessionTools.directories } }
    this.artifacts.clear(); this.references.clear(); this.attachments.clear(); this.diffs.clear(); this.terminals.clear(); this.tasks.clear()
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
    const imageIds = new Set([...this.state.attachments, ...this.state.messages.flatMap(message => "attachments" in message ? message.attachments ?? [] : [])].map(item => item.id))
    for (const id of this.images.keys()) if (!imageIds.has(id)) this.images.delete(id)
    this.publish()
  }
}
