import { isAbsolute } from "node:path"
import { startAppServerConnection, type AppServerConnection, type AppServerProcessExit } from "./connection.ts"
import type { AppServerNotification, AppServerRequest, JsonObject } from "./rpc.ts"
import type { AppServerRuntime } from "./runtime.ts"

const ROUTER_CREDENTIAL_HOST_COMMAND_ENV = "CODEM_ROUTER_CREDENTIAL_HOST_CMD"
const SESSION_SOURCE_ENV = "CODEM_SESSION_SOURCE"

export type AppServerPermissionMode = "default" | "auto" | "yolo"
export type AppServerWorkMode = "default" | "plan"
export type AppServerItemStatus = "inProgress" | "completed" | "failed" | "declined" | "interrupted"

export interface AppServerMcpServer {
  readonly type: "stdio"
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
  readonly env: readonly { readonly name: string; readonly value: string }[]
}

export interface AppServerThreadSettings {
  readonly model: string
  readonly intelligence: string
  readonly permissionMode: AppServerPermissionMode
  readonly workMode: AppServerWorkMode
  readonly additionalDirectories: readonly string[]
  readonly mcpServers: readonly AppServerMcpServer[]
}

export const DEFAULT_APP_SERVER_THREAD_SETTINGS: AppServerThreadSettings = Object.freeze({
  model: "codem/auto",
  intelligence: "medium",
  permissionMode: "auto",
  workMode: "default",
  additionalDirectories: [],
  mcpServers: [],
})

export type AppServerPromptAttachment =
  | { readonly kind: "image"; readonly path: string }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "directory"; readonly path: string }

export interface AppServerThreadSummary {
  readonly id: string
  readonly cwd: string
  readonly archived: boolean
  readonly model: string
  readonly profile: string
  readonly preview: string
  readonly startedAt: string
  readonly turnCount: number
}

export interface AppServerModelSummary {
  readonly id: string
  readonly source: string
  readonly contextWindowTokens: number
  readonly supportsVision: boolean
}

export interface AppServerSkillSummary {
  readonly name: string
  readonly description: string
}

export type AppServerPermissionPreview =
  | {
      readonly kind: "bash_command"
      readonly cwd: string
      readonly command: string
      readonly risk: Readonly<JsonObject>
      readonly suggestedRules: readonly string[]
    }
  | {
      readonly kind: "file_write"
      readonly path: string
      readonly changeSummary: string
      readonly diffExcerpt: string | null
      readonly rootSuggestion: string | null
    }
  | {
      readonly kind: "file_read"
      readonly path: string
      readonly access: "sensitive" | "outside_workspace"
      readonly scopeSuggestion: string | null
    }
  | {
      readonly kind: "mcp"
      readonly server: string
      readonly originalTool: string
      readonly argsRedacted: string
    }
  | { readonly kind: "web_fetch"; readonly url: string; readonly host: string }
  | { readonly kind: "web_search"; readonly query: string }
  | { readonly kind: "generic"; readonly summary: string }

export interface AppServerQuestion {
  readonly id: string
  readonly header: string
  readonly question: string
  readonly allowsMultipleSelection: boolean
  readonly options: readonly {
    readonly label: string
    readonly description: string
    readonly preview: string | null
  }[]
}

export type AppServerInteraction =
  | {
      readonly kind: "permission"
      readonly threadId: string
      readonly turnId: string
      readonly requestId: string
      readonly toolCallId: string | null
      readonly toolName: string
      readonly reason: string
      readonly options: readonly { readonly id: string; readonly label: string }[]
      readonly preview: AppServerPermissionPreview
    }
  | {
      readonly kind: "question"
      readonly threadId: string
      readonly turnId: string
      readonly requestId: string
      readonly questions: readonly AppServerQuestion[]
    }
  | {
      readonly kind: "rewind"
      readonly threadId: string
      readonly turnId: string
      readonly requestId: string
      readonly checkpoints: readonly {
        readonly id: string
        readonly label: string
        readonly createdAt: string | null
        readonly fileCount: number | null
        readonly diffExcerpt: string | null
        readonly warning: string | null
      }[]
      readonly modes: readonly ("code" | "conversation" | "both")[]
    }
  | {
      readonly kind: "plan"
      readonly threadId: string
      readonly turnId: string
      readonly requestId: string
      readonly plan: string
    }
  | {
      readonly kind: "plan-mode"
      readonly threadId: string
      readonly turnId: string
      readonly requestId: string
    }

export type AppServerInteractionResponse =
  | { readonly kind: "permission"; readonly optionId: string }
  | {
      readonly kind: "question"
      readonly cancelled: boolean
      readonly answers?: readonly {
        readonly question: string
        readonly selected: readonly string[]
        readonly freeText: string | null
      }[]
    }
  | {
      readonly kind: "rewind"
      readonly cancelled: boolean
      readonly checkpointId?: string
      readonly mode?: "code" | "conversation" | "both"
    }
  | { readonly kind: "plan"; readonly approved: boolean; readonly feedback?: string }
  | { readonly kind: "plan-mode"; readonly approved: boolean }

export type AppServerHostEvent =
  | { readonly type: "connection-ready"; readonly cwd: string }
  | { readonly type: "connection-closed"; readonly cwd: string; readonly exit: AppServerProcessExit }
  | { readonly type: "thread-started"; readonly cwd: string; readonly threadId: string }
  | { readonly type: "thread-closed"; readonly cwd: string; readonly threadId: string; readonly reason: string }
  | {
      readonly type: "turn-started"
      readonly threadId: string
      readonly turnId: string
      readonly submissionId: string | null
    }
  | {
      readonly type: "text-delta" | "reasoning-delta"
      readonly threadId: string
      readonly turnId: string
      readonly itemId: string
      readonly delta: string
    }
  | {
      readonly type: "item-started"
      readonly threadId: string
      readonly turnId: string
      readonly itemId: string
      readonly itemType: string
      readonly label: string
    }
  | {
      readonly type: "item-completed"
      readonly threadId: string
      readonly turnId: string
      readonly itemId: string
      readonly itemType: string
      readonly status: AppServerItemStatus
      readonly text: string
      readonly summary: string
    }
  | {
      readonly type: "plan-updated"
      readonly threadId: string
      readonly turnId: string
      readonly plan: readonly { readonly content: string; readonly status: string }[]
    }
  | {
      readonly type: "usage-updated"
      readonly threadId: string
      readonly inputTokens: number | null
      readonly outputTokens: number | null
      readonly cacheReadTokens: number | null
      readonly cacheCreationTokens: number | null
    }
  | { readonly type: "warning"; readonly threadId: string | null; readonly message: string }
  | {
      readonly type: "side-question-started"
      readonly threadId: string
      readonly operationId: string
      readonly sideQuestionId: string
      readonly question: string
    }
  | {
      readonly type: "side-question-delta"
      readonly threadId: string
      readonly sideQuestionId: string
      readonly delta: string
    }
  | {
      readonly type: "side-question-completed"
      readonly threadId: string
      readonly sideQuestionId: string
      readonly status: "completed" | "failed" | "interrupted"
      readonly error: string | null
    }
  | { readonly type: "interaction"; readonly interaction: AppServerInteraction }
  | {
      readonly type: "interaction-resolved"
      readonly threadId: string
      readonly turnId: string
      readonly requestId: string
      readonly status: "answered" | "cancelled" | "failed"
      readonly error: string | null
    }
  | {
      readonly type: "turn-completed"
      readonly threadId: string
      readonly turnId: string
      readonly outcome: "completed" | "stopped" | "failed"
      readonly stopReason: string
      readonly error: string | null
    }
  | { readonly type: "control-changed"; readonly threadId: string | null; readonly method: string }
  | { readonly type: "protocol-error"; readonly cwd: string; readonly message: string }

export interface AppServerHostOptions {
  readonly runtime: AppServerRuntime
  readonly clientInfo: { readonly name: string; readonly version: string }
  readonly assertAuthenticated: (cwd: string) => void | Promise<void>
  readonly environment?: NodeJS.ProcessEnv
  readonly onStderr?: (cwd: string, text: string) => void
}

interface ConnectionState {
  readonly cwd: string
  readonly connection: AppServerConnection
  readonly threads: Set<string>
}

interface ThreadState {
  readonly id: string
  readonly cwd: string
  readonly connection: ConnectionState
  settings: AppServerThreadSettings
  activeTurn: ActiveTurn | null
  sideQuestion: ActiveSideQuestion | null
}

interface ActiveSideQuestion {
  readonly operationId: string
  readonly question: string
  id: string | null
}

interface ActiveTurn {
  readonly submissionId: string | null
  turnId: string | null
  startedEmitted: boolean
  terminal: boolean
}

interface PendingInteraction {
  readonly rpcId: string | number
  readonly threadId: string
  readonly turnId: string
  readonly method: string
  readonly allowedOptions: ReadonlySet<string>
}

export class AppServerHost {
  private readonly options: AppServerHostOptions
  private readonly connections = new Map<string, Promise<ConnectionState>>()
  private readonly threads = new Map<string, ThreadState>()
  private readonly pendingInteractions = new Map<string, PendingInteraction>()
  private readonly listeners = new Set<(event: AppServerHostEvent) => void>()
  private closing = false
  private closePromise: Promise<void> | null = null

  constructor(options: AppServerHostOptions) {
    this.options = options
  }

  onEvent(listener: (event: AppServerHostEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prepareConnection(cwd: string): Promise<void> {
    await this.connection(cwd)
  }

  async startThread(cwd: string, settings: AppServerThreadSettings): Promise<string> {
    validateThreadSettings(cwd, settings)
    const connection = await this.connection(cwd)
    const result = objectValue(
      await connection.connection.request("thread/start", threadParameters(cwd, settings, true)),
      "thread/start result",
    )
    const thread = objectValue(result.thread, "thread/start thread")
    const threadId = nonBlankString(thread.id, "thread/start thread.id")
    this.registerThread(connection, threadId, settings)
    return threadId
  }

  async resumeThread(cwd: string, threadId: string, settings: AppServerThreadSettings): Promise<void> {
    validateThreadSettings(cwd, settings)
    const requestedId = nonBlankString(threadId, "thread/resume threadId")
    const existing = this.threads.get(requestedId)
    if (existing) {
      if (existing.cwd !== cwd) throw new Error(`CodeM thread ${requestedId} belongs to another workspace`)
      if (settingsKey(existing.settings) !== settingsKey(settings)) {
        if (existing.activeTurn) throw new Error(`CodeM thread ${requestedId} is active with different settings`)
        await this.unsubscribeThread(cwd, requestedId)
      } else {
        return
      }
    }
    const connection = await this.connection(cwd)
    const result = objectValue(
      await connection.connection.request("thread/resume", {
        ...threadParameters(cwd, settings, false),
        threadId: requestedId,
      }),
      "thread/resume result",
    )
    const thread = objectValue(result.thread, "thread/resume thread")
    const actualId = nonBlankString(thread.id, "thread/resume thread.id")
    if (actualId !== requestedId) throw new Error(`CodeM resumed ${actualId}, expected ${requestedId}`)
    this.registerThread(connection, actualId, settings)
  }

  async startTurn(input: {
    readonly cwd: string
    readonly threadId: string
    readonly submissionId: string
    readonly text: string
    readonly attachments?: readonly AppServerPromptAttachment[]
  }): Promise<string> {
    const thread = this.requireThread(input.cwd, input.threadId)
    if (thread.activeTurn || thread.sideQuestion) throw new Error(`CodeM thread ${input.threadId} is already active`)
    const submissionId = exactNonBlankString(input.submissionId, "turn/start submissionId")
    const attachments = input.attachments ?? []
    validateAttachments(attachments)
    const active: ActiveTurn = { submissionId, turnId: null, startedEmitted: false, terminal: false }
    thread.activeTurn = active
    try {
      const result = objectValue(
        await thread.connection.connection.request("turn/start", turnParameters(input, submissionId, attachments)),
        "turn/start result",
      )
      const turn = objectValue(result.turn, "turn/start turn")
      const turnId = responseTurnId(turn, "turn/start")
      if (active.turnId !== null && active.turnId !== turnId) {
        throw new Error(`CodeM turn/start changed turn identity from ${active.turnId} to ${turnId}`)
      }
      active.turnId = turnId
      if (!active.terminal) this.emitTurnStarted(thread, active, turnId)
      return turnId
    } catch (error: unknown) {
      if (thread.activeTurn === active) thread.activeTurn = null
      throw error
    }
  }

  async compactThread(cwd: string, threadId: string): Promise<string> {
    return this.startControlTurn(cwd, threadId, "thread/compact/start")
  }

  async rewindThread(cwd: string, threadId: string): Promise<string> {
    return this.startControlTurn(cwd, threadId, "thread/rewind/start")
  }

  async steerTurn(input: {
    readonly cwd: string
    readonly threadId: string
    readonly submissionId: string
    readonly text: string
  }): Promise<void> {
    const thread = this.requireThread(input.cwd, input.threadId)
    const turnId = nonBlankString(thread.activeTurn?.turnId, "turn/steer active turnId")
    const submissionId = exactNonBlankString(input.submissionId, "turn/steer submissionId")
    const result = objectValue(
      await thread.connection.connection.request("turn/steer", {
        threadId: thread.id,
        input: input.text,
        attachments: [],
        expectedTurnId: turnId,
        submissionId,
      }),
      "turn/steer result",
    )
    if (nonBlankString(result.turnId, "turn/steer turnId") !== turnId) {
      throw new Error("CodeM turn/steer changed turn identity")
    }
    if (nonBlankString(result.submissionId, "turn/steer submissionId") !== submissionId) {
      throw new Error("CodeM turn/steer changed submission identity")
    }
  }

  async interruptTurn(cwd: string, threadId: string): Promise<void> {
    const thread = this.requireThread(cwd, threadId)
    const turnId = nonBlankString(thread.activeTurn?.turnId, "turn/interrupt active turnId")
    const result = objectValue(
      await thread.connection.connection.request("turn/interrupt", { threadId, turnId }),
      "turn/interrupt result",
    )
    if (Object.keys(result).length !== 0) throw new Error("CodeM turn/interrupt result must be empty")
  }

  async cancelBackgroundTask(
    cwd: string,
    threadId: string,
    taskId: string,
  ): Promise<"cancelled" | "notFound" | "noop"> {
    const thread = this.requireThread(cwd, threadId)
    const result = objectValue(
      await thread.connection.connection.request("thread/backgroundTask/cancel", {
        threadId,
        taskId: nonBlankString(taskId, "background taskId"),
      }),
      "thread/backgroundTask/cancel result",
    )
    if (result.status !== "cancelled" && result.status !== "notFound" && result.status !== "noop") {
      throw new Error(`CodeM background cancellation returned invalid status ${String(result.status)}`)
    }
    return result.status
  }

  async startSideQuestion(cwd: string, threadId: string, operationId: string, question: string): Promise<string> {
    const thread = this.requireThread(cwd, threadId)
    if (thread.activeTurn || thread.sideQuestion) throw new Error(`CodeM thread ${threadId} is already active`)
    const active: ActiveSideQuestion = {
      operationId: exactNonBlankString(operationId, "side question operationId"),
      question: nonBlankString(question, "side question"),
      id: null,
    }
    thread.sideQuestion = active
    try {
      const result = objectValue(
        await thread.connection.connection.request("thread/sideQuestion/start", {
          threadId,
          question: active.question,
        }),
        "thread/sideQuestion/start result",
      )
      const accepted = objectValue(result.sideQuestion, "thread/sideQuestion/start sideQuestion")
      const sideQuestionId = nonBlankString(accepted.id, "thread/sideQuestion/start sideQuestion.id")
      if (accepted.status !== "accepted") {
        throw new Error(`CodeM side question returned invalid status ${String(accepted.status)}`)
      }
      if (active.id !== null && active.id !== sideQuestionId) {
        throw new Error(`CodeM side question response ${sideQuestionId} conflicts with notification ${active.id}`)
      }
      active.id = sideQuestionId
      return sideQuestionId
    } catch (error: unknown) {
      if (thread.sideQuestion === active) thread.sideQuestion = null
      throw error
    }
  }

  async cancelSideQuestion(cwd: string, threadId: string, sideQuestionId: string): Promise<void> {
    const thread = this.requireThread(cwd, threadId)
    if (!thread.sideQuestion || thread.sideQuestion.id !== sideQuestionId) {
      throw new Error(`CodeM side question ${sideQuestionId} is not active`)
    }
    const result = objectValue(
      await thread.connection.connection.request("thread/sideQuestion/cancel", {
        threadId,
        sideQuestionId: nonBlankString(sideQuestionId, "side question id"),
      }),
      "thread/sideQuestion/cancel result",
    )
    if (result.sideQuestionId !== sideQuestionId || result.status !== "cancelled")
      throw new Error(`CodeM side question cancellation returned ${String(result.status)}`)
  }

  async respondToInteraction(requestId: string, response: AppServerInteractionResponse): Promise<void> {
    const id = nonBlankString(requestId, "interaction requestId")
    const pending = this.pendingInteractions.get(id)
    if (!pending) throw new Error(`CodeM interaction ${id} is not pending`)
    const thread = this.threads.get(pending.threadId)
    if (!thread?.activeTurn || thread.activeTurn.turnId !== pending.turnId) {
      throw new Error(`CodeM interaction ${id} belongs to a stale turn`)
    }
    const expectedKind = interactionKind(pending.method)
    if (response.kind !== expectedKind) throw new Error(`CodeM interaction ${id} requires a ${expectedKind} response`)
    const result = interactionResult(pending, response)
    this.pendingInteractions.delete(id)
    thread.connection.connection.peer.respond(pending.rpcId, result)
  }

  async readModes(cwd: string, threadId: string): Promise<Readonly<JsonObject>> {
    const thread = this.requireThread(cwd, threadId)
    return objectValue(
      await thread.connection.connection.request("thread/mode/read", { threadId }),
      "thread/mode/read result",
    )
  }

  async setModes(input: {
    readonly cwd: string
    readonly threadId: string
    readonly expectedRevision: number
    readonly permissionMode?: AppServerPermissionMode
    readonly workMode?: "normal" | "plan"
  }): Promise<Readonly<JsonObject>> {
    const thread = this.requireThread(input.cwd, input.threadId)
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new Error("CodeM thread/mode/set expectedRevision must be a non-negative integer")
    }
    if (input.permissionMode === undefined && input.workMode === undefined) {
      throw new Error("CodeM thread/mode/set requires a mode change")
    }
    return objectValue(
      await thread.connection.connection.request("thread/mode/set", {
        threadId: input.threadId,
        expectedRevision: input.expectedRevision,
        ...(input.permissionMode === undefined ? {} : { permissionMode: input.permissionMode }),
        ...(input.workMode === undefined ? {} : { workMode: input.workMode }),
      }),
      "thread/mode/set result",
    )
  }

  async listThreads(
    cwd: string,
    cursor?: string,
  ): Promise<{
    readonly threads: readonly AppServerThreadSummary[]
    readonly nextCursor: string | null
    readonly total: number
  }> {
    const connection = await this.connection(cwd)
    const result = objectValue(
      await connection.connection.request("thread/list", { cwd, ...(cursor ? { cursor } : {}) }),
      "thread/list result",
    )
    const entries = arrayValue(result.threads, "thread/list threads")
    return {
      threads: entries.map((entry, index) => threadSummary(entry, cwd, `thread/list threads[${index}]`)),
      nextCursor: nullableString(result.nextCursor, "thread/list nextCursor"),
      total: nonNegativeInteger(result.total, "thread/list total"),
    }
  }

  async listModels(
    cwd: string,
  ): Promise<{ readonly activeModel: string; readonly models: readonly AppServerModelSummary[] }> {
    const connection = await this.connection(cwd)
    const result = objectValue(await connection.connection.request("model/list", { cwd }), "model/list result")
    return {
      activeModel: nonBlankString(result.activeModel, "model/list activeModel"),
      models: arrayValue(result.models, "model/list models").map((entry, index) => {
        const model = objectValue(entry, `model/list models[${index}]`)
        return {
          id: nonBlankString(model.id, `model/list models[${index}].id`),
          source: nonBlankString(model.source, `model/list models[${index}].source`),
          contextWindowTokens: nonNegativeInteger(
            model.contextWindowTokens,
            `model/list models[${index}].contextWindowTokens`,
          ),
          supportsVision: booleanValue(model.supportsVision, `model/list models[${index}].supportsVision`),
        }
      }),
    }
  }

  async listSkills(cwd: string, threadId?: string): Promise<readonly AppServerSkillSummary[]> {
    const connection = threadId ? this.requireThread(cwd, threadId).connection : await this.connection(cwd)
    const result = objectValue(
      await connection.connection.request("skills/list", { cwd, ...(threadId ? { threadId } : {}) }),
      "skills/list result",
    )
    return arrayValue(result.skills, "skills/list skills").map((entry, index) => {
      const skill = objectValue(entry, `skills/list skills[${index}]`)
      return {
        name: nonBlankString(skill.name, `skills/list skills[${index}].name`),
        description: stringValue(skill.description, `skills/list skills[${index}].description`),
      }
    })
  }

  async control(
    cwd: string,
    method: "thread/name/set" | "thread/archive" | "thread/unarchive" | "thread/delete" | "thread/fork",
    params: JsonObject,
  ): Promise<Readonly<JsonObject>> {
    const threadId = nonBlankString(params.threadId, `${method} threadId`)
    const loaded = this.threads.get(threadId)
    if (loaded?.activeTurn || loaded?.sideQuestion) throw new Error(`Cannot ${method} active CodeM thread ${threadId}`)
    if (loaded && loaded.cwd !== cwd) throw new Error(`CodeM thread ${threadId} belongs to another workspace`)
    if (loaded && method !== "thread/fork" && method !== "thread/name/set") await this.unsubscribeThread(cwd, threadId)
    const connection = loaded?.connection ?? (await this.connection(cwd))
    const result = objectValue(await connection.connection.request(method, { ...params, cwd }), `${method} result`)
    return result
  }

  async unsubscribeThread(cwd: string, threadId: string): Promise<void> {
    const thread = this.requireThread(cwd, threadId)
    if (thread.activeTurn) await this.interruptTurn(cwd, threadId)
    if (thread.sideQuestion?.id) await this.cancelSideQuestion(cwd, threadId, thread.sideQuestion.id)
    const result = objectValue(
      await thread.connection.connection.request("thread/unsubscribe", { threadId }),
      "thread/unsubscribe result",
    )
    if (Object.keys(result).length !== 0) throw new Error("CodeM thread/unsubscribe result must be empty")
    this.forgetThread(thread, "unsubscribed")
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.closePromise = this.closeResources()
    return this.closePromise
  }

  private async closeResources(): Promise<void> {
    const connections = await Promise.allSettled(this.connections.values())
    for (const result of connections) {
      if (result.status !== "fulfilled") continue
      for (const threadId of result.value.threads) {
        const thread = this.threads.get(threadId)
        if (thread?.activeTurn) {
          await this.interruptTurn(thread.cwd, thread.id).catch(() => undefined)
        }
        if (thread?.sideQuestion?.id) {
          await this.cancelSideQuestion(thread.cwd, thread.id, thread.sideQuestion.id).catch(() => undefined)
        }
        await result.value.connection.request("thread/unsubscribe", { threadId }).catch(() => undefined)
      }
    }
    await Promise.all(
      connections.flatMap((result) => (result.status === "fulfilled" ? [result.value.connection.close()] : [])),
    )
    this.connections.clear()
    this.threads.clear()
    this.pendingInteractions.clear()
  }

  private async startControlTurn(
    cwd: string,
    threadId: string,
    method: "thread/compact/start" | "thread/rewind/start",
  ): Promise<string> {
    const thread = this.requireThread(cwd, threadId)
    if (thread.activeTurn || thread.sideQuestion) throw new Error(`CodeM thread ${threadId} is already active`)
    const active: ActiveTurn = { submissionId: null, turnId: null, startedEmitted: false, terminal: false }
    thread.activeTurn = active
    try {
      const result = objectValue(await thread.connection.connection.request(method, { threadId }), `${method} result`)
      const turn = objectValue(result.turn, `${method} turn`)
      const turnId = responseTurnId(turn, method)
      if (active.turnId !== null && active.turnId !== turnId) throw new Error(`CodeM ${method} changed turn identity`)
      active.turnId = turnId
      if (!active.terminal) this.emitTurnStarted(thread, active, turnId)
      return turnId
    } catch (error: unknown) {
      if (thread.activeTurn === active) thread.activeTurn = null
      throw error
    }
  }

  private async connection(cwd: string): Promise<ConnectionState> {
    if (this.closing) throw new Error("CodeM App Server host is shutting down")
    if (!isAbsolute(cwd)) throw new Error(`CodeM App Server cwd must be absolute: ${cwd}`)
    const existing = this.connections.get(cwd)
    if (existing) return existing
    const opening = this.openConnection(cwd)
    this.connections.set(cwd, opening)
    try {
      return await opening
    } catch (error: unknown) {
      if (this.connections.get(cwd) === opening) this.connections.delete(cwd)
      throw error
    }
  }

  private async openConnection(cwd: string): Promise<ConnectionState> {
    await this.options.assertAuthenticated(cwd)
    let state: ConnectionState | null = null
    const connection = await startAppServerConnection({
      runtime: this.options.runtime,
      workingDirectory: cwd,
      clientInfo: this.options.clientInfo,
      arguments: ["--final-answer-tool", "app-server"],
      environment: appServerHostEnvironment(this.options.runtime, this.options.environment),
      onNotification: (notification) => {
        if (state) this.handleNotification(state, notification)
      },
      onRequest: (request, peer) => {
        if (!state) {
          peer.respondError(request.id, -32603, "CodeM host is not ready")
          return
        }
        this.handleRequest(state, request)
      },
      onProtocolError: (error) => this.emit({ type: "protocol-error", cwd, message: error.message }),
      onStderr: (text) => this.options.onStderr?.(cwd, text),
      onExit: (exit) => {
        this.emit({ type: "connection-closed", cwd, exit })
        const current = this.connections.get(cwd)
        if (state && current) {
          for (const threadId of state.threads) {
            const thread = this.threads.get(threadId)
            if (thread) this.forgetThread(thread, "connection-closed")
          }
          this.connections.delete(cwd)
        }
      },
    })
    state = { cwd, connection, threads: new Set() }
    this.emit({ type: "connection-ready", cwd })
    return state
  }

  private registerThread(connection: ConnectionState, threadId: string, settings: AppServerThreadSettings): void {
    const existing = this.threads.get(threadId)
    if (existing && existing.connection !== connection)
      throw new Error(`CodeM thread ${threadId} arrived on another connection`)
    const thread: ThreadState = existing ?? {
      id: threadId,
      cwd: connection.cwd,
      connection,
      settings,
      activeTurn: null,
      sideQuestion: null,
    }
    thread.settings = settings
    this.threads.set(threadId, thread)
    connection.threads.add(threadId)
    this.emit({ type: "thread-started", cwd: connection.cwd, threadId })
  }

  private requireThread(cwd: string, threadId: string): ThreadState {
    const id = nonBlankString(threadId, "threadId")
    const thread = this.threads.get(id)
    if (!thread) throw new Error(`CodeM thread ${id} is not loaded`)
    if (thread.cwd !== cwd) throw new Error(`CodeM thread ${id} belongs to another workspace`)
    return thread
  }

  private forgetThread(thread: ThreadState, reason: string): void {
    if (this.threads.get(thread.id) !== thread) return
    this.threads.delete(thread.id)
    thread.connection.threads.delete(thread.id)
    for (const [requestId, pending] of this.pendingInteractions) {
      if (pending.threadId === thread.id) this.pendingInteractions.delete(requestId)
    }
    this.emit({ type: "thread-closed", cwd: thread.cwd, threadId: thread.id, reason })
  }

  private handleNotification(connection: ConnectionState, frame: AppServerNotification): void {
    const threadId = optionalString(frame.params.threadId)
    const thread = threadId ? this.threads.get(threadId) : null
    if (thread && thread.connection !== connection) return
    if (frame.method === "warning") {
      const message = optionalString(frame.params.message)
      if (message) this.emit({ type: "warning", threadId, message })
      return
    }
    if (frame.method === "skills/changed") {
      this.emit({ type: "control-changed", threadId, method: frame.method })
      return
    }
    if (!thread) return
    if (frame.method === "thread/closed" || frame.method === "thread/archived" || frame.method === "thread/deleted") {
      this.forgetThread(thread, frame.method)
      return
    }
    if (
      frame.method === "thread/mode/changed" ||
      frame.method === "thread/name/updated" ||
      frame.method === "thread/unarchived"
    ) {
      this.emit({ type: "control-changed", threadId: thread.id, method: frame.method })
      return
    }
    if (frame.method === "thread/tokenUsage/updated") {
      const usage = objectValue(frame.params.usage, "thread/tokenUsage/updated usage")
      this.emit({
        type: "usage-updated",
        threadId: thread.id,
        inputTokens: optionalNumber(usage.inputTokens),
        outputTokens: optionalNumber(usage.outputTokens),
        cacheReadTokens: optionalNumber(usage.cacheReadTokens),
        cacheCreationTokens: optionalNumber(usage.cacheCreationTokens),
      })
      return
    }
    if (frame.method === "serverRequest/resolved") {
      this.handleInteractionResolved(thread, frame.params)
      return
    }
    if (frame.method.startsWith("thread/sideQuestion/")) {
      this.handleSideQuestion(thread, frame)
      return
    }
    const active = thread.activeTurn
    if (!active) return
    const turnId = notificationTurnId(frame.params, active)
    if (!turnId) return
    if (frame.method === "turn/started") {
      active.turnId = turnId
      this.emitTurnStarted(thread, active, turnId)
      return
    }
    if (frame.method === "turn/completed") {
      this.completeTurn(thread, active, turnId, frame.params)
      return
    }
    if (frame.method === "item/agentMessage/delta" || frame.method === "item/reasoning/textDelta") {
      const itemId = nonBlankString(frame.params.itemId, `${frame.method} itemId`)
      const delta = notificationDelta(frame.params, frame.method)
      this.emit({
        type: frame.method === "item/agentMessage/delta" ? "text-delta" : "reasoning-delta",
        threadId: thread.id,
        turnId,
        itemId,
        delta,
      })
      return
    }
    if (frame.method === "item/started" || frame.method === "item/completed") {
      this.handleItem(thread, turnId, frame)
      return
    }
    if (frame.method === "turn/plan/updated") {
      const plan = arrayValue(frame.params.plan, "turn/plan/updated plan").map((entry, index) => {
        const item = objectValue(entry, `turn/plan/updated plan[${index}]`)
        return {
          content: nonBlankString(item.content, `turn/plan/updated plan[${index}].content`),
          status: nonBlankString(item.status, `turn/plan/updated plan[${index}].status`),
        }
      })
      this.emit({ type: "plan-updated", threadId: thread.id, turnId, plan })
    }
  }

  private handleItem(thread: ThreadState, turnId: string, frame: AppServerNotification): void {
    const item = objectValue(frame.params.item, `${frame.method} item`)
    const itemId = nonBlankString(item.id, `${frame.method} item.id`)
    const itemType = nonBlankString(item.type, `${frame.method} item.type`)
    if (frame.method === "item/started") {
      this.emit({
        type: "item-started",
        threadId: thread.id,
        turnId,
        itemId,
        itemType,
        label: optionalString(item.tool) ?? optionalString(item.label) ?? itemType,
      })
      return
    }
    this.emit({
      type: "item-completed",
      threadId: thread.id,
      turnId,
      itemId,
      itemType,
      status: itemStatus(item.status, item.isError),
      text: optionalString(item.text) ?? "",
      summary: boundedText(item.summary ?? item.output ?? ""),
    })
  }

  private completeTurn(thread: ThreadState, active: ActiveTurn, turnId: string, params: JsonObject): void {
    if (active.terminal) return
    const turn = objectValue(params.turn, "turn/completed turn")
    const completedId = responseTurnId(turn, "turn/completed")
    if (completedId !== turnId)
      throw new Error(`CodeM turn/completed changed turn identity from ${turnId} to ${completedId}`)
    active.terminal = true
    const status = nonBlankString(turn.status, "turn/completed status")
    const stopReason = nonBlankString(turn.stopReason, "turn/completed stopReason")
    const error = optionalString(objectOrNull(turn.error)?.message)
    const outcome = status === "interrupted" ? "stopped" : status === "completed" ? "completed" : "failed"
    for (const [requestId, pending] of this.pendingInteractions) {
      if (pending.threadId !== thread.id || pending.turnId !== turnId) continue
      this.pendingInteractions.delete(requestId)
      this.emit({
        type: "interaction-resolved",
        threadId: thread.id,
        turnId,
        requestId,
        status: "cancelled",
        error: null,
      })
    }
    if (thread.activeTurn === active) thread.activeTurn = null
    this.emit({ type: "turn-completed", threadId: thread.id, turnId, outcome, stopReason, error })
  }

  private handleRequest(connection: ConnectionState, request: AppServerRequest): void {
    try {
      const threadId = nonBlankString(request.params.threadId, `${request.method} threadId`)
      const thread = this.threads.get(threadId)
      if (!thread || thread.connection !== connection || !thread.activeTurn) {
        connection.connection.peer.respondError(request.id, -32602, "No active CodeM turn")
        return
      }
      const requestId = nonBlankString(request.params.requestId, `${request.method} requestId`)
      if (this.pendingInteractions.has(requestId)) throw new Error(`Duplicate CodeM interaction ${requestId}`)
      const requestTurnId = nonBlankString(request.params.turnId, `${request.method} turnId`)
      const active = thread.activeTurn
      if (active.turnId !== null && active.turnId !== requestTurnId) {
        connection.connection.peer.respondError(request.id, -32602, "Request belongs to a stale turn")
        return
      }
      active.turnId = requestTurnId
      const interaction = parseInteraction(request, threadId, requestTurnId)
      this.pendingInteractions.set(requestId, {
        rpcId: request.id,
        threadId,
        turnId: requestTurnId,
        method: request.method,
        allowedOptions: new Set(
          interaction.kind === "permission" ? interaction.options.map((option) => option.id) : [],
        ),
      })
      this.emit({ type: "interaction", interaction })
    } catch (error: unknown) {
      connection.connection.peer.respondError(request.id, -32602, errorMessage(error))
    }
  }

  private handleInteractionResolved(thread: ThreadState, params: JsonObject): void {
    const requestId = optionalString(params.requestId)
    const turnId = optionalString(params.turnId)
    if (!requestId || !turnId) return
    const pending = this.pendingInteractions.get(requestId)
    if (!pending || pending.threadId !== thread.id || pending.turnId !== turnId) return
    this.pendingInteractions.delete(requestId)
    const status =
      params.status === "failed"
        ? "failed"
        : params.status === "cancelled" || params.answered === false
          ? "cancelled"
          : "answered"
    this.emit({
      type: "interaction-resolved",
      threadId: thread.id,
      turnId,
      requestId,
      status,
      error: status === "failed" ? (optionalString(params.error) ?? "CodeM interaction failed") : null,
    })
  }

  private handleSideQuestion(thread: ThreadState, frame: AppServerNotification): void {
    const active = thread.sideQuestion
    if (!active) return
    if (frame.method === "thread/sideQuestion/started") {
      const value = objectValue(frame.params.sideQuestion, "side question started")
      const sideQuestionId = nonBlankString(value.id, "side question started id")
      const question = nonBlankString(value.question, "side question started question")
      if (value.status !== "inProgress" || question !== active.question) {
        throw new Error("CodeM side question start notification does not match the request")
      }
      if (active.id !== null && active.id !== sideQuestionId)
        throw new Error(`Unexpected side question ${sideQuestionId}`)
      active.id = sideQuestionId
      this.emit({
        type: "side-question-started",
        threadId: thread.id,
        operationId: active.operationId,
        sideQuestionId,
        question,
      })
      return
    }
    const sideQuestionId = nonBlankString(
      frame.method === "thread/sideQuestion/completed"
        ? objectValue(frame.params.sideQuestion, "side question completed").id
        : frame.params.sideQuestionId,
      `${frame.method} sideQuestionId`,
    )
    if (active.id !== sideQuestionId) return
    if (frame.method === "thread/sideQuestion/delta") {
      this.emit({
        type: "side-question-delta",
        threadId: thread.id,
        sideQuestionId,
        delta: notificationDelta(frame.params, frame.method),
      })
      return
    }
    if (frame.method !== "thread/sideQuestion/completed") return
    const value = objectValue(frame.params.sideQuestion, "side question completed")
    const status = value.status
    if (status !== "completed" && status !== "failed" && status !== "interrupted") {
      throw new Error(`Invalid side question terminal status ${String(status)}`)
    }
    const error =
      status === "failed"
        ? nonBlankString(objectValue(value.error, "side question error").message, "side question error.message")
        : null
    thread.sideQuestion = null
    this.emit({ type: "side-question-completed", threadId: thread.id, sideQuestionId, status, error })
  }

  private emitTurnStarted(thread: ThreadState, active: ActiveTurn, turnId: string): void {
    if (active.startedEmitted) return
    active.startedEmitted = true
    this.emit({ type: "turn-started", threadId: thread.id, turnId, submissionId: active.submissionId })
  }

  private emit(event: AppServerHostEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // Consumers cannot take authority over transport lifecycle.
      }
    }
  }
}

export function appServerHostEnvironment(
  runtime: AppServerRuntime,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...base }
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === ROUTER_CREDENTIAL_HOST_COMMAND_ENV.toLowerCase()) delete environment[key]
    if (key.toLowerCase() === SESSION_SOURCE_ENV.toLowerCase()) delete environment[key]
  }
  return {
    ...environment,
    [ROUTER_CREDENTIAL_HOST_COMMAND_ENV]: JSON.stringify([runtime.authExecutablePath, "__host-serve"]),
    [SESSION_SOURCE_ENV]: "vscode",
  }
}

function threadParameters(cwd: string, settings: AppServerThreadSettings, isNewThread: boolean): JsonObject {
  return {
    cwd,
    model: settings.model,
    extensions: { codem: { intelligence: settings.intelligence } },
    additionalDirectories: [...settings.additionalDirectories],
    mcpServers: settings.mcpServers.map((server) => ({
      type: server.type,
      name: server.name,
      command: server.command,
      args: [...server.args],
      env: server.env.map((entry) => ({ ...entry })),
    })),
    ...(isNewThread ? { permissionMode: settings.permissionMode, executionMode: settings.workMode } : {}),
  }
}

function turnParameters(
  input: { readonly threadId: string; readonly text: string },
  submissionId: string,
  attachments: readonly AppServerPromptAttachment[],
): JsonObject {
  const images = attachments.filter((attachment) => attachment.kind === "image")
  const files = attachments.filter((attachment) => attachment.kind !== "image")
  return {
    threadId: input.threadId,
    clientUserMessageId: submissionId,
    input: [
      { type: "text", text: input.text, textElements: [] },
      ...images.map((image) => ({ type: "localImage", path: image.path })),
    ],
    ...(files.length === 0
      ? {}
      : { extensions: { codem: { attachments: files.map((attachment) => ({ ...attachment })) } } }),
  }
}

function parseInteraction(request: AppServerRequest, threadId: string, turnId: string): AppServerInteraction {
  const requestId = nonBlankString(request.params.requestId, `${request.method} requestId`)
  if (request.method.endsWith("/requestApproval") && !request.method.includes("/plan")) {
    const options = arrayValue(request.params.options, `${request.method} options`).map((entry, index) => {
      const option = objectValue(entry, `${request.method} options[${index}]`)
      return {
        id: nonBlankString(option.optionId, `${request.method} options[${index}].optionId`),
        label: nonBlankString(option.label, `${request.method} options[${index}].label`),
      }
    })
    if (options.length === 0) throw new Error(`CodeM ${request.method} requires approval options`)
    return {
      kind: "permission",
      threadId,
      turnId,
      requestId,
      toolCallId: optionalString(request.params.callId),
      toolName: optionalString(request.params.tool) ?? "tool",
      reason: optionalString(request.params.reason) ?? "",
      options,
      preview: permissionPreview(request.params.preview),
    }
  }
  if (request.method === "item/tool/requestUserInput") {
    return {
      kind: "question",
      threadId,
      turnId,
      requestId,
      questions: questionList(request.params.questions),
    }
  }
  if (request.method === "item/rewind/requestSelection") {
    return {
      kind: "rewind",
      threadId,
      turnId,
      requestId,
      checkpoints: rewindCheckpoints(request.params.checkpoints),
      modes: rewindModes(request.params.modes),
    }
  }
  if (request.method === "item/plan/requestApproval") {
    return {
      kind: "plan",
      threadId,
      turnId,
      requestId,
      plan: nonBlankString(request.params.plan, "plan approval plan"),
    }
  }
  if (request.method === "item/planMode/requestApproval") {
    return { kind: "plan-mode", threadId, turnId, requestId }
  }
  throw new Error(`Unsupported CodeM client request: ${request.method}`)
}

function interactionResult(pending: PendingInteraction, response: AppServerInteractionResponse): JsonObject {
  if (response.kind === "permission") {
    if (!pending.allowedOptions.has(response.optionId))
      throw new Error(`CodeM permission option ${response.optionId} was not offered`)
    return { outcome: { optionId: response.optionId } }
  }
  if (response.kind === "question") {
    return response.cancelled ? { cancelled: true } : { answers: response.answers ?? [] }
  }
  if (response.kind === "rewind") {
    if (response.cancelled) return { status: "cancelled" }
    return {
      status: "selected",
      checkpointId: nonBlankString(response.checkpointId, "rewind checkpointId"),
      mode: rewindMode(response.mode, "rewind mode"),
    }
  }
  if (response.kind === "plan") {
    return { approved: response.approved, ...(response.approved ? {} : { feedback: response.feedback ?? "" }) }
  }
  return { approved: response.approved }
}

function permissionPreview(value: unknown): AppServerPermissionPreview {
  const preview = objectValue(value, "permission preview")
  const kind = nonBlankString(preview.kind, "permission preview kind")
  if (kind === "bash_command") {
    return {
      kind,
      cwd: nonBlankString(preview.cwd, "permission preview cwd"),
      command: nonBlankString(preview.command, "permission preview command"),
      risk: objectValue(preview.risk, "permission preview risk"),
      suggestedRules: stringArray(preview.suggestedRules, "permission preview suggestedRules"),
    }
  }
  if (kind === "file_write") {
    return {
      kind,
      path: nonBlankString(preview.path, "permission preview path"),
      changeSummary: stringValue(preview.changeSummary, "permission preview changeSummary"),
      diffExcerpt: nullableString(preview.diffExcerpt, "permission preview diffExcerpt"),
      rootSuggestion: nullableString(preview.rootSuggestion, "permission preview rootSuggestion"),
    }
  }
  if (kind === "file_read") {
    const access = preview.access
    if (access !== "sensitive" && access !== "outside_workspace")
      throw new Error(`Invalid permission preview access ${String(access)}`)
    return {
      kind,
      path: nonBlankString(preview.path, "permission preview path"),
      access,
      scopeSuggestion: nullableString(preview.scopeSuggestion, "permission preview scopeSuggestion"),
    }
  }
  if (kind === "mcp") {
    return {
      kind,
      server: nonBlankString(preview.server, "permission preview server"),
      originalTool: nonBlankString(preview.originalTool, "permission preview originalTool"),
      argsRedacted: stringValue(preview.argsRedacted, "permission preview argsRedacted"),
    }
  }
  if (kind === "web_fetch") {
    return {
      kind,
      url: nonBlankString(preview.url, "permission preview url"),
      host: nonBlankString(preview.host, "permission preview host"),
    }
  }
  if (kind === "web_search") return { kind, query: nonBlankString(preview.query, "permission preview query") }
  if (kind === "generic") return { kind, summary: nonBlankString(preview.summary, "permission preview summary") }
  throw new Error(`Unsupported CodeM permission preview kind ${kind}`)
}

function questionList(value: unknown): readonly AppServerQuestion[] {
  return arrayValue(value, "user questions").map((entry, index) => {
    const question = objectValue(entry, `user questions[${index}]`)
    return {
      id: optionalString(question.id) ?? `question-${index + 1}`,
      header: optionalString(question.header) ?? "",
      question: nonBlankString(question.question, `user questions[${index}].question`),
      allowsMultipleSelection: question.allowsMultipleSelection === true || question.multi_select === true,
      options: arrayValue(question.options ?? [], `user questions[${index}].options`).map(
        (optionEntry, optionIndex) => {
          const option = objectValue(optionEntry, `user questions[${index}].options[${optionIndex}]`)
          return {
            label: nonBlankString(option.label, `user questions[${index}].options[${optionIndex}].label`),
            description: optionalString(option.description) ?? "",
            preview: nullableString(option.preview, `user questions[${index}].options[${optionIndex}].preview`),
          }
        },
      ),
    }
  })
}

function rewindCheckpoints(value: unknown): Extract<AppServerInteraction, { kind: "rewind" }>["checkpoints"] {
  const checkpoints = arrayValue(value, "rewind checkpoints")
  if (checkpoints.length === 0) throw new Error("CodeM rewind requires checkpoints")
  return checkpoints.map((entry, index) => {
    const checkpoint = objectValue(entry, `rewind checkpoints[${index}]`)
    return {
      id: nonBlankString(checkpoint.id, `rewind checkpoints[${index}].id`),
      label: nonBlankString(checkpoint.label, `rewind checkpoints[${index}].label`),
      createdAt: nullableString(checkpoint.createdAt, `rewind checkpoints[${index}].createdAt`),
      fileCount: nullableNonNegativeInteger(checkpoint.fileCount, `rewind checkpoints[${index}].fileCount`),
      diffExcerpt: nullableString(checkpoint.diffExcerpt, `rewind checkpoints[${index}].diffExcerpt`),
      warning: nullableString(
        objectOrNull(checkpoint.warning)?.message,
        `rewind checkpoints[${index}].warning.message`,
      ),
    }
  })
}

function rewindModes(value: unknown): readonly ("code" | "conversation" | "both")[] {
  const modes = arrayValue(value, "rewind modes").map((entry) => rewindMode(entry, "rewind mode"))
  if (modes.length === 0) throw new Error("CodeM rewind requires modes")
  return modes
}

function rewindMode(value: unknown, label: string): "code" | "conversation" | "both" {
  if (value !== "code" && value !== "conversation" && value !== "both")
    throw new Error(`CodeM ${label} is invalid: ${String(value)}`)
  return value
}

function threadSummary(value: unknown, cwd: string, label: string): AppServerThreadSummary {
  const thread = objectValue(value, label)
  return {
    id: nonBlankString(thread.id, `${label}.id`),
    cwd,
    archived: booleanValue(thread.archived, `${label}.archived`),
    model: nonBlankString(thread.model, `${label}.model`),
    profile: nonBlankString(thread.profile, `${label}.profile`),
    preview: stringValue(thread.preview, `${label}.preview`),
    startedAt: nonBlankString(thread.startedAt, `${label}.startedAt`),
    turnCount: nonNegativeInteger(thread.turnCount, `${label}.turnCount`),
  }
}

function responseTurnId(turn: JsonObject, label: string): string {
  const standard = optionalString(turn.id)
  const legacy = optionalString(turn.turnId)
  if (standard && legacy && standard !== legacy) throw new Error(`CodeM ${label} returned conflicting turn ids`)
  return nonBlankString(standard ?? legacy, `${label} turn id`)
}

function notificationTurnId(params: JsonObject, active: ActiveTurn): string | null {
  const turn = objectOrNull(params.turn)
  const turnId = optionalString(turn?.id ?? params.turnId)
  if (!turnId) return active.turnId
  if (active.turnId !== null && active.turnId !== turnId) return null
  active.turnId = turnId
  return turnId
}

function notificationDelta(params: JsonObject, label: string): string {
  const delta = optionalString(params.delta)
  const legacy = optionalString(params.deltaText)
  if (delta !== null && legacy !== null && delta !== legacy)
    throw new Error(`CodeM ${label} returned conflicting delta fields`)
  return nonBlankString(delta ?? legacy, `${label} delta`)
}

function itemStatus(value: unknown, isError: unknown): AppServerItemStatus {
  if (
    value === "inProgress" ||
    value === "completed" ||
    value === "failed" ||
    value === "declined" ||
    value === "interrupted"
  )
    return value
  return isError === true ? "failed" : "completed"
}

function validateThreadSettings(cwd: string, settings: AppServerThreadSettings): void {
  if (!isAbsolute(cwd)) throw new Error(`CodeM thread cwd must be absolute: ${cwd}`)
  nonBlankString(settings.model, "thread model")
  nonBlankString(settings.intelligence, "thread intelligence")
  if (
    settings.permissionMode !== "default" &&
    settings.permissionMode !== "auto" &&
    settings.permissionMode !== "yolo"
  ) {
    throw new Error(`CodeM thread permission mode is invalid: ${String(settings.permissionMode)}`)
  }
  if (settings.workMode !== "default" && settings.workMode !== "plan") {
    throw new Error(`CodeM thread work mode is invalid: ${String(settings.workMode)}`)
  }
  for (const directory of settings.additionalDirectories) {
    if (!isAbsolute(directory)) throw new Error(`CodeM additional directory must be absolute: ${directory}`)
  }
  const names = new Set<string>()
  for (const server of settings.mcpServers) {
    if (server.type !== "stdio" || !isAbsolute(server.command))
      throw new Error(`CodeM MCP ${server.name} requires an absolute stdio command`)
    const name = nonBlankString(server.name, "MCP server name")
    if (names.has(name)) throw new Error(`Duplicate CodeM MCP server name: ${name}`)
    names.add(name)
  }
}

function validateAttachments(attachments: readonly AppServerPromptAttachment[]): void {
  for (const attachment of attachments) {
    if (attachment.kind !== "image" && attachment.kind !== "file" && attachment.kind !== "directory") {
      throw new Error(`Unsupported CodeM attachment kind: ${String((attachment as { kind?: unknown }).kind)}`)
    }
    nonBlankString(attachment.path, "attachment path")
  }
}

function settingsKey(settings: AppServerThreadSettings): string {
  return JSON.stringify({
    model: settings.model,
    intelligence: settings.intelligence,
    additionalDirectories: settings.additionalDirectories,
    mcpServers: settings.mcpServers,
  })
}

function interactionKind(method: string): AppServerInteraction["kind"] {
  if (method === "item/tool/requestUserInput") return "question"
  if (method === "item/rewind/requestSelection") return "rewind"
  if (method === "item/plan/requestApproval") return "plan"
  if (method === "item/planMode/requestApproval") return "plan-mode"
  return "permission"
}

function objectValue(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`CodeM ${label} must be an object`)
  return value as JsonObject
}

function objectOrNull(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`CodeM ${label} must be an array`)
  return value
}

function nonBlankString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`CodeM ${label} must be non-empty`)
  return value
}

function exactNonBlankString(value: unknown, label: string): string {
  const text = nonBlankString(value, label)
  if (text !== text.trim()) throw new Error(`CodeM ${label} must not contain surrounding whitespace`)
  return text
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`CodeM ${label} must be a string`)
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  return stringValue(value, label)
}

function stringArray(value: unknown, label: string): readonly string[] {
  const entries = arrayValue(value, label)
  if (!entries.every((entry) => typeof entry === "string")) throw new Error(`CodeM ${label} must contain strings`)
  return entries as readonly string[]
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`CodeM ${label} must be a boolean`)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new Error(`CodeM ${label} must be a non-negative integer`)
  return value
}

function nullableNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  return nonNegativeInteger(value, label)
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function boundedText(value: unknown): string {
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value)
  return text.length <= 4_000 ? text : `${text.slice(0, 3_999)}…`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
