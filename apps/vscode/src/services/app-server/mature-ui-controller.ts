import { randomUUID } from "node:crypto"
import type {
  AppServerHostEvent,
  AppServerModelSummary,
  AppServerPromptAttachment,
  AppServerSkillSummary,
  AppServerThreadSummary,
} from "@codem/app-server"
import { APP_SERVER_BUILTIN_INTELLIGENCE_TIERS } from "@codem/app-server"
import type { ExtensionMessage } from "../../../webview-ui/src/types/messages/extension-messages"
import type { WebviewMessage } from "../../../webview-ui/src/types/messages/webview-messages"
import { AppServerMatureUiAdapter } from "./mature-ui-adapter.ts"

type AppServerMessageType =
  | "requestThreadModes"
  | "setThreadPermissionMode"
  | "abort"
  | "cancelBackgroundJob"
  | "compact"
  | "createSession"
  | "deleteSession"
  | "enhancePrompt"
  | "forkSession"
  | "loadMessages"
  | "loadSessions"
  | "permissionResponse"
  | "questionReject"
  | "questionReply"
  | "renameSession"
  | "requestBackgroundJobs"
  | "requestProviders"
  | "requestSkills"
  | "sendCommand"
  | "sendMessage"

export const APP_SERVER_MATURE_UI_COMMANDS = [
  "requestThreadModes",
  "setThreadPermissionMode",
  "abort",
  "cancelBackgroundJob",
  "compact",
  "createSession",
  "deleteSession",
  "enhancePrompt",
  "forkSession",
  "loadMessages",
  "loadSessions",
  "permissionResponse",
  "questionReject",
  "questionReply",
  "renameSession",
  "requestBackgroundJobs",
  "requestProviders",
  "requestSkills",
  "sendCommand",
  "sendMessage",
] as const satisfies readonly AppServerMessageType[]

export interface MatureUiPrompt {
  readonly text: string
  readonly attachments: readonly AppServerPromptAttachment[]
}

export interface MatureUiAppServerPort {
  readModes: import("./service").CodeMAppServerService["readModes"]
  setModes: import("./service").CodeMAppServerService["setModes"]
  startThread(cwd: string, model?: string, intelligence?: string): Promise<string>
  resumeThread(cwd: string, threadId: string, model?: string, intelligence?: string): Promise<void>
  listThreads(
    cwd: string,
    cursor?: string,
  ): Promise<{
    readonly threads: readonly AppServerThreadSummary[]
    readonly nextCursor: string | null
    readonly total: number
  }>
  listTurns(
    cwd: string,
    threadId: string,
    options?: { readonly cursor?: string; readonly limit?: number; readonly sortDirection?: "asc" | "desc" },
  ): ReturnType<import("./service").CodeMAppServerService["listTurns"]>
  listItems(
    cwd: string,
    threadId: string,
    options?: {
      readonly turnId?: string
      readonly cursor?: string
      readonly limit?: number
      readonly sortDirection?: "asc" | "desc"
    },
  ): ReturnType<import("./service").CodeMAppServerService["listItems"]>
  listModels(cwd: string): Promise<{ readonly activeModel: string; readonly models: readonly AppServerModelSummary[] }>
  startTurn(
    cwd: string,
    threadId: string,
    submissionId: string,
    text: string,
    attachments?: readonly AppServerPromptAttachment[],
  ): Promise<string>
  steerTurn(cwd: string, threadId: string, submissionId: string, text: string): Promise<void>
  interrupt(cwd: string, threadId: string): Promise<void>
  compactThread(cwd: string, threadId: string): Promise<string>
  cancelBackgroundTask(cwd: string, threadId: string, taskId: string): Promise<"cancelled" | "notFound" | "noop">
  startSideQuestion(cwd: string, threadId: string, operationId: string, question: string): Promise<string>
  renameThread(cwd: string, threadId: string, name: string): Promise<void>
  deleteThread(cwd: string, threadId: string): Promise<void>
  forkThread(cwd: string, threadId: string): Promise<string>
  listSkills(cwd: string, threadId?: string): Promise<readonly AppServerSkillSummary[]>
  respondToInteraction(
    requestId: string,
    response: ReturnType<AppServerMatureUiAdapter["permissionResponse" | "questionResponse" | "rejectInteraction"]>,
  ): Promise<void>
}

export interface MatureUiAppServerControllerOptions {
  readonly service: MatureUiAppServerPort
  readonly adapter?: AppServerMatureUiAdapter
  readonly cwdForThread: (threadId?: string) => string
  readonly preparePrompt: (
    message: Extract<WebviewMessage, { readonly type: "sendMessage" }>,
  ) => Promise<MatureUiPrompt>
  readonly post: (message: ExtensionMessage) => void | Promise<void>
  readonly selectThread: (threadId: string | null) => void
}

/**
 * App Server command side of the mature Webview bridge.
 *
 * Only commands with a complete Core v1 semantic mapping are accepted here.
 * Kilo-only commands remain outside this list so the parity gate can prevent a
 * partial production cutover instead of silently dropping or approximating UI
 * behavior.
 */
export class MatureUiAppServerController {
  private readonly service: MatureUiAppServerPort
  private readonly adapter: AppServerMatureUiAdapter
  private readonly options: MatureUiAppServerControllerOptions
  private readonly loadedThreads = new Set<string>()
  private readonly runningThreads = new Set<string>()
  private currentThreadId: string | null = null

  constructor(options: MatureUiAppServerControllerOptions) {
    this.options = options
    this.service = options.service
    this.adapter = options.adapter ?? new AppServerMatureUiAdapter()
  }

  accepts(type: WebviewMessage["type"]): type is AppServerMessageType {
    return (APP_SERVER_MATURE_UI_COMMANDS as readonly string[]).includes(type)
  }

  async handle(message: WebviewMessage): Promise<boolean> {
    if (!this.accepts(message.type)) return false
    const accepted = message as Extract<WebviewMessage, { readonly type: AppServerMessageType }>
    try {
      if (accepted.type === "requestThreadModes" || accepted.type === "setThreadPermissionMode")
        await this.handleModes(accepted)
      else await this.handleAccepted(accepted)
    } catch (error: unknown) {
      this.postFailure(accepted, error)
    }
    return true
  }

  clearSelection(): void {
    this.setCurrentThread(null)
  }

  async refreshSpace(): Promise<void> {
    // Service retires loaded threads before publishing a selected space.
    this.clearSelection()
    await this.handle({ type: "requestProviders" })
    await this.handle({ type: "requestSkills" })
  }

  acceptEvent(event: AppServerHostEvent): void {
    const threadId = eventThreadId(event)
    if (threadId && !this.loadedThreads.has(threadId)) return
    if (event.type === "thread-closed") {
      this.loadedThreads.delete(event.threadId)
      this.runningThreads.delete(event.threadId)
      if (this.currentThreadId === event.threadId) this.setCurrentThread(null)
    }
    if (event.type === "turn-started") this.runningThreads.add(event.threadId)
    if (event.type === "turn-completed") this.runningThreads.delete(event.threadId)
    for (const message of this.adapter.accept(event)) this.post(message)
  }

  private async handleAccepted(
    message: Extract<WebviewMessage, { readonly type: AppServerMessageType }>,
  ): Promise<void> {
    switch (message.type) {
      case "createSession":
        return this.createSession()
      case "loadSessions":
        return this.loadSessions()
      case "loadMessages":
        return this.loadMessages(message)
      case "sendMessage":
        return this.sendMessage(message)
      case "sendCommand":
        return this.sendCommand(message)
      case "abort":
        return this.interrupt(message.sessionID)
      case "compact":
        return this.compact(message.sessionID)
      case "deleteSession":
        return this.deleteSession(message.sessionID)
      case "renameSession":
        return this.renameSession(message.sessionID, message.title)
      case "forkSession":
        return this.forkSession(message.sessionId)
      case "permissionResponse":
        return this.service.respondToInteraction(
          message.permissionId,
          this.adapter.permissionResponse(message.permissionId, message.response),
        )
      case "questionReply":
        return this.service.respondToInteraction(
          message.requestID,
          this.adapter.questionResponse(message.requestID, message.answers),
        )
      case "questionReject":
        return this.service.respondToInteraction(message.requestID, this.adapter.rejectInteraction(message.requestID))
      case "requestBackgroundJobs":
        return this.post(this.adapter.backgroundJobsLoaded(message.sessionID, message.requestID))
      case "requestProviders":
        return this.loadModels()
      case "cancelBackgroundJob":
        return this.cancelBackgroundJob(message.sessionID, message.jobID, message.requestID)
      case "enhancePrompt":
        return this.enhancePrompt(message.text, message.requestId)
      case "requestSkills":
        return this.loadSkills()
    }
  }

  private async handleModes(
    message: Extract<WebviewMessage, { type: "requestThreadModes" | "setThreadPermissionMode" }>,
  ): Promise<void> {
    for (const [name, value] of [
      ["sessionID", message.sessionID],
      ["requestID", message.requestID],
    ]) {
      if (typeof value !== "string" || !value.trim() || value !== value.trim())
        throw new Error(`Invalid CodeM mode ${name}`)
    }
    const cwd = this.options.cwdForThread(message.sessionID)
    await this.ensureLoaded(cwd, message.sessionID)
    const state =
      message.type === "requestThreadModes"
        ? await this.service.readModes(cwd, message.sessionID)
        : await this.service.setModes({
            cwd,
            threadId: message.sessionID,
            expectedRevision: message.expectedRevision,
            permissionMode: message.permissionMode,
          })
    this.post({
      type: "threadModesResult",
      sessionID: message.sessionID,
      requestID: message.requestID,
      result: { state },
    })
  }

  private async createSession(draftId?: string, model?: string, intelligence?: string): Promise<void> {
    const cwd = this.options.cwdForThread()
    const threadId = await this.service.startThread(cwd, model, intelligence)
    this.loadedThreads.add(threadId)
    this.setCurrentThread(threadId)
    const thread = await this.findThread(cwd, threadId)
    this.post(this.adapter.sessionCreated(thread, draftId))
  }

  private async loadSessions(): Promise<void> {
    const cwd = this.options.cwdForThread()
    const result = await this.service.listThreads(cwd)
    this.post(this.adapter.sessionsLoaded(result.threads))
  }

  private async loadMessages(message: Extract<WebviewMessage, { readonly type: "loadMessages" }>): Promise<void> {
    const cwd = this.options.cwdForThread(message.sessionID)
    await this.ensureLoaded(cwd, message.sessionID)
    const turns = await this.service.listTurns(cwd, message.sessionID, {
      ...(message.before ? { cursor: message.before } : {}),
      limit: message.limit ?? 50,
      sortDirection: "desc",
    })
    const orderedTurns = [...turns.entries].reverse()
    const items = (
      await Promise.all(
        orderedTurns.map((turn) =>
          this.service.listItems(cwd, message.sessionID, {
            turnId: turn.id,
            limit: 500,
            sortDirection: "asc",
          }),
        ),
      )
    ).flatMap((page) => page.entries)
    const requestedMode = message.mode === "focus" ? "replace" : message.mode
    const mode =
      this.runningThreads.has(message.sessionID) && (!requestedMode || requestedMode === "replace")
        ? "reconcile"
        : requestedMode
    this.setCurrentThread(message.sessionID)
    this.post(
      this.adapter.messagesLoaded({
        threadId: message.sessionID,
        turns: orderedTurns,
        items,
        mode,
        ...(turns.nextCursor ? { cursor: turns.nextCursor } : {}),
        hasMore: turns.nextCursor !== null,
      }),
    )
  }

  private async sendMessage(message: Extract<WebviewMessage, { readonly type: "sendMessage" }>): Promise<void> {
    let threadId = message.sessionID ?? this.currentThreadId
    const model = selectedModel(message)
    const intelligence = selectedIntelligence(message.variant)
    if (!threadId) {
      await this.createSession(typeof message.draftID === "string" ? message.draftID : undefined, model, intelligence)
      threadId = this.currentThreadId
    }
    if (!threadId) throw new Error("CodeM could not create a thread")
    const cwd = this.options.cwdForThread(threadId)
    const prompt = await this.options.preparePrompt(message)
    const submissionId =
      typeof message.messageID === "string" && message.messageID.trim() ? message.messageID : randomUUID()
    for (const update of this.adapter.submissionStarted({ threadId, submissionId, text: prompt.text }))
      this.post(update)
    if (this.runningThreads.has(threadId)) {
      if (prompt.attachments.length > 0) throw new Error("CodeM cannot add attachments while steering an active turn")
      await this.service.steerTurn(cwd, threadId, submissionId, prompt.text)
      return
    }
    await this.ensureLoaded(cwd, threadId, model, intelligence)
    await this.service.startTurn(cwd, threadId, submissionId, prompt.text, prompt.attachments)
  }

  private sendCommand(message: Extract<WebviewMessage, { readonly type: "sendCommand" }>): Promise<void> {
    return this.sendMessage({
      type: "sendMessage",
      text: `/${message.command}${message.arguments.trim() ? ` ${message.arguments.trim()}` : ""}`,
      ...(message.messageID ? { messageID: message.messageID } : {}),
      ...(message.sessionID ? { sessionID: message.sessionID } : {}),
      ...(message.draftID ? { draftID: message.draftID } : {}),
      ...(message.providerID ? { providerID: message.providerID } : {}),
      ...(message.modelID ? { modelID: message.modelID } : {}),
      ...(message.agent ? { agent: message.agent } : {}),
      ...(message.variant ? { variant: message.variant } : {}),
      ...(message.files ? { files: message.files } : {}),
      ...(message.agentManagerContext ? { agentManagerContext: message.agentManagerContext } : {}),
      ...(message.contextDirectory ? { contextDirectory: message.contextDirectory } : {}),
    })
  }

  private async interrupt(threadId: string): Promise<void> {
    const cwd = this.options.cwdForThread(threadId)
    await this.ensureLoaded(cwd, threadId)
    await this.service.interrupt(cwd, threadId)
  }

  private async compact(threadId?: string): Promise<void> {
    const target = threadId ?? this.currentThreadId
    if (!target) throw new Error("Select a CodeM thread before compacting")
    const cwd = this.options.cwdForThread(target)
    await this.ensureLoaded(cwd, target)
    await this.service.compactThread(cwd, target)
  }

  private async deleteSession(threadId: string): Promise<void> {
    const cwd = this.options.cwdForThread(threadId)
    await this.service.deleteThread(cwd, threadId)
    this.loadedThreads.delete(threadId)
    if (this.currentThreadId === threadId) this.setCurrentThread(null)
    this.post({ type: "sessionDeleted", sessionID: threadId })
  }

  private async renameSession(threadId: string, title: string): Promise<void> {
    const cwd = this.options.cwdForThread(threadId)
    await this.service.renameThread(cwd, threadId, title)
    this.post({ type: "sessionUpdated", session: { id: threadId, title } })
  }

  private async forkSession(sourceThreadId: string): Promise<void> {
    const cwd = this.options.cwdForThread(sourceThreadId)
    const threadId = await this.service.forkThread(cwd, sourceThreadId)
    const thread = await this.findThread(cwd, threadId)
    this.post(this.adapter.sessionForked(thread, sourceThreadId))
  }

  private async cancelBackgroundJob(threadId: string, taskId: string, requestId: string): Promise<void> {
    const cwd = this.options.cwdForThread(threadId)
    await this.ensureLoaded(cwd, threadId)
    await this.service.cancelBackgroundTask(cwd, threadId, taskId)
    this.post(this.adapter.backgroundJobsLoaded(threadId, requestId))
  }

  private async enhancePrompt(text: string, requestId: string): Promise<void> {
    const threadId = this.currentThreadId
    if (!threadId) throw new Error("Select a CodeM thread before enhancing a prompt")
    const cwd = this.options.cwdForThread(threadId)
    await this.ensureLoaded(cwd, threadId)
    await this.service.startSideQuestion(cwd, threadId, requestId, text)
  }

  private async loadSkills(): Promise<void> {
    const cwd = this.options.cwdForThread(this.currentThreadId ?? undefined)
    const skills = await this.service.listSkills(cwd, this.currentThreadId ?? undefined)
    this.post({
      type: "skillsLoaded",
      skills: skills.map((skill) => ({ ...skill, location: "codem-app-server" })),
    })
  }

  private async loadModels(): Promise<void> {
    const cwd = this.options.cwdForThread(this.currentThreadId ?? undefined)
    const catalog = await this.service.listModels(cwd)
    this.post(modelsLoaded(catalog))
  }

  private async ensureLoaded(cwd: string, threadId: string, model?: string, intelligence?: string): Promise<void> {
    if (this.loadedThreads.has(threadId) && !model && !intelligence) return
    await this.service.resumeThread(cwd, threadId, model, intelligence)
    this.loadedThreads.add(threadId)
  }

  private async findThread(cwd: string, threadId: string): Promise<AppServerThreadSummary> {
    const result = await this.service.listThreads(cwd)
    const thread = result.threads.find((entry) => entry.id === threadId)
    if (!thread) throw new Error(`CodeM thread ${threadId} was not returned by thread/list`)
    return thread
  }

  private setCurrentThread(threadId: string | null): void {
    this.currentThreadId = threadId
    this.options.selectThread(threadId)
  }

  private post(message: ExtensionMessage): void {
    void this.options.post(message)
  }

  private postFailure(message: Extract<WebviewMessage, { readonly type: AppServerMessageType }>, error: unknown): void {
    const reason = error instanceof Error && error.message.trim() ? error.message : "CodeM App Server operation failed"
    if (message.type === "requestThreadModes" || message.type === "setThreadPermissionMode") {
      this.post({
        type: "threadModesResult",
        sessionID: message.sessionID,
        requestID: message.requestID,
        result: { error: reason },
      })
      return
    }
    if (message.type === "sendMessage" || message.type === "sendCommand") {
      this.post({
        type: "sendMessageFailed",
        error: reason,
        text: message.type === "sendMessage" ? message.text : `/${message.command} ${message.arguments}`.trim(),
        ...(message.sessionID ? { sessionID: message.sessionID } : {}),
        ...(message.draftID ? { draftID: message.draftID } : {}),
        ...(message.messageID ? { messageID: message.messageID } : {}),
        ...(message.files ? { files: message.files } : {}),
      })
      return
    }
    if (message.type === "enhancePrompt") {
      this.post({ type: "enhancePromptError", requestId: message.requestId, error: reason })
      return
    }
    this.post({ type: "error", message: reason, ...(sessionId(message) ? { sessionID: sessionId(message) } : {}) })
  }
}

function modelsLoaded(catalog: {
  readonly activeModel: string
  readonly models: readonly AppServerModelSummary[]
}): Extract<ExtensionMessage, { readonly type: "providersLoaded" }> {
  const providers: Extract<ExtensionMessage, { readonly type: "providersLoaded" }>["providers"] = {}
  const defaults: Record<string, string> = {}
  for (const model of catalog.models) {
    const selection = splitModel(model.id)
    const provider = (providers[selection.providerID] ??= {
      id: selection.providerID,
      name: selection.providerID.startsWith("codem") ? "CodeM" : selection.providerID,
      models: {},
      source: "api",
    })
    provider.models[selection.modelID] = {
      id: selection.modelID,
      name: model.id === catalog.activeModel ? "CodeM 智能选择" : selection.modelID,
      contextLength: model.contextWindowTokens,
      capabilities: {
        reasoning: true,
        input: { text: true, image: model.supportsVision, audio: false, video: false, pdf: false },
      },
      ...(model.source === "builtin"
        ? { variants: Object.fromEntries(APP_SERVER_BUILTIN_INTELLIGENCE_TIERS.map((tier) => [tier, {}])) }
        : {}),
    }
  }
  const active = splitModel(catalog.activeModel)
  defaults[active.providerID] = active.modelID
  return {
    type: "providersLoaded",
    providers,
    connected: Object.keys(providers),
    defaults,
    organizationId: null,
    ready: true,
    defaultSelection: active,
    authMethods: {},
    authStates: {},
  }
}

function selectedModel(message: { readonly providerID?: string; readonly modelID?: string }): string | undefined {
  if (!message.providerID && !message.modelID) return undefined
  if (!message.providerID || !message.modelID) throw new Error("CodeM model selection is incomplete")
  return `${message.providerID}/${message.modelID}`
}

function selectedIntelligence(variant: string | undefined): string | undefined {
  if (variant === undefined || variant === "") return undefined
  if (!(APP_SERVER_BUILTIN_INTELLIGENCE_TIERS as readonly string[]).includes(variant)) {
    throw new Error(`CodeM intelligence ${variant} is not supported by the selected model`)
  }
  return variant
}

function splitModel(model: string): { readonly providerID: string; readonly modelID: string } {
  const separator = model.indexOf("/")
  if (separator <= 0 || separator === model.length - 1) throw new Error(`CodeM Core returned invalid model ${model}`)
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) }
}

function eventThreadId(event: AppServerHostEvent): string | undefined {
  if ("threadId" in event && typeof event.threadId === "string") return event.threadId
  if (event.type === "interaction") return event.interaction.threadId
  return undefined
}

function sessionId(message: WebviewMessage): string | undefined {
  if ("sessionID" in message && typeof message.sessionID === "string") return message.sessionID
  if ("sessionId" in message && typeof message.sessionId === "string") return message.sessionId
  return undefined
}
