import type {
  AppServerFileDiff,
  AppServerHistoryItem,
  AppServerHostEvent,
  AppServerInteraction,
  AppServerInteractionResponse,
  AppServerItem,
  AppServerThreadSummary,
  AppServerTurnSummary,
} from "@codem/app-server"
import type { BackgroundJobInfo, ExtensionMessage } from "../../../webview-ui/src/types/messages/extension-messages"
import type { PermissionFileDiff } from "../../../webview-ui/src/types/messages/permissions"
import type { Message, MessageLoadMode, SessionInfo } from "../../../webview-ui/src/types/messages/sessions"
import type { Part, ToolPart } from "../../../webview-ui/src/types/messages/parts"

type PendingInteraction =
  | Extract<AppServerInteraction, { readonly kind: "permission" }>
  | Exclude<AppServerInteraction, { readonly kind: "permission" }>

interface TurnView {
  readonly messageId: string
  readonly startedAt: string
}

type AssistantViewMessage = Message & {
  role: "assistant"
  time: { created: number; completed?: number }
}

// The retained renderer requires time even while streaming. Keep live and
// durable assistant projections on the same presentation contract.
function assistantMessage(threadId: string, view: TurnView, completedAt?: number): AssistantViewMessage {
  return {
    id: view.messageId,
    sessionID: threadId,
    role: "assistant",
    createdAt: view.startedAt,
    time: {
      created: Date.parse(view.startedAt),
      ...(completedAt === undefined ? {} : { completed: completedAt }),
    },
  }
}

interface ToolView {
  readonly threadId: string
  readonly turnId: string
  readonly messageId: string
  readonly itemId: string
  readonly callId: string
  readonly toolName: string
  readonly input: Record<string, unknown>
  title: string
  output: string
  diff?: PermissionFileDiff
  guard?: Record<string, unknown>
  background: boolean
}

interface SideQuestionView {
  readonly operationId: string
  text: string
}

interface BackgroundJobView {
  readonly id: string
  readonly threadId: string
  readonly itemId: string
  readonly title: string
  readonly startedAt: number
  status: BackgroundJobInfo["status"]
  completedAt?: number
  error?: string
  background: boolean
}

/**
 * Transitional presentation adapter for the mature Solid Webview.
 *
 * App Server identity and terminal semantics stay authoritative. This adapter
 * only projects strict CodeM DTOs into the existing Webview's message/part
 * vocabulary while the React/shadcn rewrite proceeds. It never accepts a raw
 * JSON-RPC frame and never owns durable history.
 */
export class AppServerMatureUiAdapter {
  private readonly turns = new Map<string, TurnView>()
  private readonly toolsByItem = new Map<string, ToolView>()
  private readonly toolsByCall = new Map<string, ToolView>()
  private readonly streamedItems = new Set<string>()
  private readonly pendingInteractions = new Map<string, PendingInteraction>()
  private readonly sideQuestions = new Map<string, SideQuestionView>()
  private readonly backgroundJobs = new Map<string, BackgroundJobView>()
  private readonly backgroundTaskIds = new Set<string>()
  private readonly hookSequenceByTurn = new Map<string, number>()

  sessionsLoaded(threads: readonly AppServerThreadSummary[]): ExtensionMessage {
    return { type: "sessionsLoaded", sessions: threads.map(threadToSession) }
  }

  sessionCreated(thread: AppServerThreadSummary, draftId?: string): ExtensionMessage {
    return {
      type: "sessionCreated",
      session: threadToSession(thread),
      activate: true,
      ...(draftId ? { draftID: draftId } : {}),
    }
  }

  sessionForked(thread: AppServerThreadSummary, forkedFromId: string): ExtensionMessage {
    return {
      type: "sessionForked",
      sessionID: thread.id,
      forkedFromID: forkedFromId,
    }
  }

  messagesLoaded(input: {
    readonly threadId: string
    readonly turns: readonly AppServerTurnSummary[]
    readonly items: readonly AppServerHistoryItem[]
    readonly mode?: Exclude<MessageLoadMode, "focus">
    readonly cursor?: string
    readonly hasMore?: boolean
  }): ExtensionMessage {
    return {
      type: "messagesLoaded",
      sessionID: input.threadId,
      messages: historyMessages(input.threadId, input.turns, input.items),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.hasMore === undefined ? {} : { hasMore: input.hasMore }),
    }
  }

  submissionStarted(input: {
    readonly threadId: string
    readonly submissionId: string
    readonly text: string
    readonly createdAt?: string
  }): readonly ExtensionMessage[] {
    // The mature Webview already owns the optimistic user message. Confirming
    // it here lets an in-flight empty history snapshot erase the prompt before
    // Core has persisted the turn. Core history remains the durable authority.
    return [{ type: "sessionStatus", sessionID: input.threadId, status: "busy" }]
  }

  backgroundJobsLoaded(threadId: string, requestId: string): ExtensionMessage {
    return {
      type: "backgroundJobsLoaded",
      sessionID: threadId,
      requestID: requestId,
      jobs: [...this.backgroundJobs.values()]
        .filter((job) => job.threadId === threadId && job.background)
        .map(backgroundJobInfo),
    }
  }

  accept(event: AppServerHostEvent): readonly ExtensionMessage[] {
    if (event.type === "thread-modes-updated")
      return [{ type: "threadModesChanged", sessionID: event.threadId, state: event.state }]
    return this.acceptTimeline(event) ?? this.acceptInteraction(event) ?? this.acceptLifecycle(event)
  }

  private acceptTimeline(event: AppServerHostEvent): readonly ExtensionMessage[] | null {
    switch (event.type) {
      case "turn-started":
        return this.turnStarted(event.threadId, event.turnId)
      case "text-delta":
      case "reasoning-delta":
        return [this.textDelta(event)]
      case "item-started":
        return this.itemStarted(event.threadId, event.turnId, event.item)
      case "item-output-delta":
        return this.itemOutput(event)
      case "tool-guard":
        return this.toolGuard(event)
      case "file-diff":
        return this.fileDiff(event)
      case "item-completed":
        return this.itemCompleted(event.threadId, event.turnId, event.item)
      case "plan-updated":
        return [
          {
            type: "todoUpdated",
            sessionID: event.threadId,
            items: event.plan.map((item, index) => ({
              id: `${event.turnId}:plan:${index + 1}`,
              content: item.content,
              status:
                item.status === "completed" ? "completed" : item.status === "inProgress" ? "in_progress" : "pending",
            })),
          },
        ]
      case "diff-updated":
        return [
          {
            type: "sessionUpdated",
            session: {
              id: event.threadId,
              summary: {
                additions: event.files.reduce((total, file) => total + file.linesAdded, 0),
                deletions: event.files.reduce((total, file) => total + file.linesRemoved, 0),
                files: event.files.length,
              },
            },
          },
        ]
      case "usage-updated":
        return [{ type: "sessionModelUsageChanged", sessionID: event.threadId }]
      case "turn-completed":
        return this.turnCompleted(event)
      default:
        return null
    }
  }

  private acceptInteraction(event: AppServerHostEvent): readonly ExtensionMessage[] | null {
    switch (event.type) {
      case "interaction":
        return [this.interactionStarted(event.interaction)]
      case "interaction-resolved":
        return this.interactionResolved(event.requestId, event.status)
      default:
        return null
    }
  }

  private acceptLifecycle(event: AppServerHostEvent): readonly ExtensionMessage[] {
    switch (event.type) {
      case "thread-closed":
        return [
          { type: "threadModesChanged", sessionID: event.threadId, state: null },
          event.reason === "thread/deleted"
            ? { type: "sessionDeleted", sessionID: event.threadId }
            : { type: "sessionStatus", sessionID: event.threadId, status: "idle" },
        ]
      case "warning":
        return [{ type: "error", message: event.message, ...(event.threadId ? { sessionID: event.threadId } : {}) }]
      case "protocol-error":
        return [{ type: "error", message: event.message }]
      case "connection-closed":
        return event.exit.expected
          ? []
          : [
              {
                type: "error",
                message: `CodeM Core exited unexpectedly (${event.exit.code ?? event.exit.signal ?? "unknown"})`,
              },
            ]
      case "authentication-invalidated":
        return [{ type: "error", message: event.message }]
      case "hook-completed":
        return [this.hookCompleted(event)]
      case "background-wake":
        return this.backgroundWake(event)
      case "side-question-started":
        this.sideQuestions.set(event.sideQuestionId, { operationId: event.operationId, text: "" })
        return []
      case "side-question-delta": {
        const question = this.sideQuestions.get(event.sideQuestionId)
        if (question) question.text += event.delta
        return []
      }
      case "side-question-completed":
        return this.sideQuestionCompleted(event)
      case "thread-started":
      case "connection-ready":
      case "control-changed":
        return []
      default:
        return []
    }
  }

  permissionResponse(requestId: string, response: "once" | "always" | "reject"): AppServerInteractionResponse {
    const interaction = this.requireInteraction(requestId, "permission")
    const intent = response === "once" ? "allow_once" : response === "always" ? "allow_always" : "reject_once"
    const option = interaction.options.find((entry) => optionIntent(entry.id, entry.label) === intent)
    if (!option) throw new Error(`CodeM permission ${requestId} did not offer ${response}`)
    return { kind: "permission", optionId: option.id }
  }

  questionResponse(requestId: string, answers: readonly (readonly string[])[]): AppServerInteractionResponse {
    const interaction = this.pendingInteractions.get(requestId)
    if (!interaction) throw new Error(`CodeM interaction ${requestId} is not pending`)
    if (interaction.kind === "question") {
      if (answers.length !== interaction.questions.length) {
        throw new Error(`CodeM question ${requestId} returned the wrong answer count`)
      }
      return {
        kind: "question",
        cancelled: false,
        answers: interaction.questions.map((question, index) => {
          const values = [...(answers[index] ?? [])]
          const offered = new Set(question.options.map((option) => option.label))
          const selected = values.filter((value) => offered.has(value))
          const custom = values.filter((value) => !offered.has(value))
          return {
            question: question.question,
            selected,
            freeText: custom.length > 0 ? custom.join("\n") : null,
          }
        }),
      }
    }
    if (interaction.kind === "plan") {
      const choice = answers[0]?.[0]
      return choice === "Approve"
        ? { kind: "plan", approved: true }
        : { kind: "plan", approved: false, feedback: choice === "Reject" ? "" : (choice ?? "") }
    }
    if (interaction.kind === "plan-mode") {
      return { kind: "plan-mode", approved: answers[0]?.[0] === "Approve" }
    }
    if (interaction.kind === "rewind") {
      const checkpointId = answers[0]?.[0]
      const mode = answers[1]?.[0]
      if (!checkpointId || !interaction.checkpoints.some((entry) => entry.id === checkpointId)) {
        throw new Error(`CodeM rewind ${requestId} returned an unknown checkpoint`)
      }
      if (mode !== "code" && mode !== "conversation" && mode !== "both") {
        throw new Error(`CodeM rewind ${requestId} returned an unknown mode`)
      }
      return { kind: "rewind", cancelled: false, checkpointId, mode }
    }
    throw new Error(`CodeM interaction ${requestId} does not accept question answers`)
  }

  rejectInteraction(requestId: string): AppServerInteractionResponse {
    const interaction = this.pendingInteractions.get(requestId)
    if (!interaction) throw new Error(`CodeM interaction ${requestId} is not pending`)
    if (interaction.kind === "permission") return this.permissionResponse(requestId, "reject")
    if (interaction.kind === "question") return { kind: "question", cancelled: true }
    if (interaction.kind === "rewind") return { kind: "rewind", cancelled: true }
    if (interaction.kind === "plan") return { kind: "plan", approved: false, feedback: "" }
    return { kind: "plan-mode", approved: false }
  }

  private turnStarted(threadId: string, turnId: string): readonly ExtensionMessage[] {
    const key = turnKey(threadId, turnId)
    if (this.turns.has(key)) return []
    const startedAt = new Date().toISOString()
    const view = { messageId: assistantMessageId(turnId), startedAt }
    this.turns.set(key, view)
    return [
      {
        type: "messageCreated",
        message: assistantMessage(threadId, view),
      },
      { type: "sessionStatus", sessionID: threadId, status: "busy" },
    ]
  }

  private textDelta(
    event: Extract<AppServerHostEvent, { readonly type: "text-delta" | "reasoning-delta" }>,
  ): ExtensionMessage {
    const view = this.requireTurn(event.threadId, event.turnId)
    this.streamedItems.add(itemKey(event.threadId, event.turnId, event.itemId))
    const part: Part =
      event.type === "text-delta"
        ? { id: event.itemId, type: "text", text: event.delta, sessionID: event.threadId, messageID: view.messageId }
        : {
            id: event.itemId,
            type: "reasoning",
            text: event.delta,
            sessionID: event.threadId,
            messageID: view.messageId,
          }
    return {
      type: "partUpdated",
      sessionID: event.threadId,
      messageID: view.messageId,
      part,
      delta: { type: "text-delta", textDelta: event.delta },
    }
  }

  private itemStarted(threadId: string, turnId: string, item: AppServerItem): readonly ExtensionMessage[] {
    if (!item.toolName || !item.callId) return []
    const view = this.requireTurn(threadId, turnId)
    const tool: ToolView = {
      threadId,
      turnId,
      messageId: view.messageId,
      itemId: item.id,
      callId: item.callId,
      toolName: uiToolName(item.toolName),
      input: uiToolInput(item),
      title: item.label,
      output: "",
      background: item.subagentId ? this.backgroundTaskIds.has(item.subagentId) : false,
    }
    this.toolsByItem.set(itemKey(threadId, turnId, item.id), tool)
    this.toolsByCall.set(callKey(threadId, turnId, item.callId), tool)
    if (item.type === "subagent" && item.subagentId) {
      this.backgroundJobs.set(item.subagentId, {
        id: item.subagentId,
        threadId,
        itemId: item.id,
        title: item.label,
        startedAt: Date.now(),
        status: "running",
        background: tool.background,
      })
    }
    return [toolPartUpdate(tool, { status: "running", input: tool.input, title: tool.title }, toolMetadata(tool))]
  }

  private itemOutput(
    event: Extract<AppServerHostEvent, { readonly type: "item-output-delta" }>,
  ): readonly ExtensionMessage[] {
    const tool = this.toolsByCall.get(callKey(event.threadId, event.turnId, event.toolCallId))
    if (!tool) return []
    tool.output = appendToolOutput(tool.output, event.delta)
    tool.title = lastNonEmptyLine(tool.output) ?? tool.title
    return [toolPartUpdate(tool, { status: "running", input: tool.input, title: tool.title }, toolMetadata(tool))]
  }

  private toolGuard(event: Extract<AppServerHostEvent, { readonly type: "tool-guard" }>): readonly ExtensionMessage[] {
    const tool = this.toolsByCall.get(callKey(event.threadId, event.turnId, event.guard.toolCallId))
    if (!tool) return []
    tool.guard = { ...event.guard }
    return [toolPartUpdate(tool, { status: "running", input: tool.input, title: tool.title }, toolMetadata(tool))]
  }

  private fileDiff(event: Extract<AppServerHostEvent, { readonly type: "file-diff" }>): readonly ExtensionMessage[] {
    const tool = this.toolsByCall.get(callKey(event.threadId, event.turnId, event.diff.source.toolCallId))
    if (!tool) return []
    tool.diff = legacyFileDiff(event.diff)
    return [toolPartUpdate(tool, { status: "running", input: tool.input, title: tool.title }, toolMetadata(tool))]
  }

  private itemCompleted(threadId: string, turnId: string, item: AppServerItem): readonly ExtensionMessage[] {
    const streamed = this.streamedItems.delete(itemKey(threadId, turnId, item.id))
    const message = this.completedMessageItem(threadId, turnId, item, streamed)
    if (message) return [message]
    if (item.type === "contextCompaction" && !item.toolName) {
      const view = this.requireTurn(threadId, turnId)
      return [
        {
          type: "partUpdated",
          sessionID: threadId,
          messageID: view.messageId,
          part: {
            id: item.id,
            type: "compaction",
            auto: true,
            sessionID: threadId,
            messageID: view.messageId,
          },
        },
      ]
    }
    const tools = this.completedToolItem(threadId, turnId, item)
    if (!item.finalAnswer || item.status !== "completed") return tools
    const view = this.requireTurn(threadId, turnId)
    return [
      ...tools,
      {
        type: "partUpdated",
        sessionID: threadId,
        messageID: view.messageId,
        part: {
          id: `${item.id}:summary`,
          type: "text",
          text: item.finalAnswer.summary,
          sessionID: threadId,
          messageID: view.messageId,
          metadata: {
            appServerFinalAnswer: true,
            status: item.finalAnswer.status,
            kind: item.finalAnswer.kind,
            artifactCount: item.finalAnswer.artifacts.length,
          },
        },
      },
    ]
  }

  private completedMessageItem(
    threadId: string,
    turnId: string,
    item: AppServerItem,
    streamed: boolean,
  ): ExtensionMessage | null {
    if ((item.type !== "agentMessage" && item.type !== "reasoning") || !item.text || streamed) return null
    const view = this.requireTurn(threadId, turnId)
    const part: Part =
      item.type === "agentMessage"
        ? { id: item.id, type: "text", text: item.text, sessionID: threadId, messageID: view.messageId }
        : { id: item.id, type: "reasoning", text: item.text, sessionID: threadId, messageID: view.messageId }
    return { type: "partUpdated", sessionID: threadId, messageID: view.messageId, part }
  }

  private completedToolItem(threadId: string, turnId: string, item: AppServerItem): readonly ExtensionMessage[] {
    const tool =
      (item.callId ? this.toolsByCall.get(callKey(threadId, turnId, item.callId)) : undefined) ??
      this.toolsByItem.get(itemKey(threadId, turnId, item.id))
    if (!tool) return []
    this.toolsByItem.delete(itemKey(threadId, turnId, item.id))
    this.toolsByCall.delete(callKey(threadId, turnId, tool.callId))
    if (item.type === "subagent" && item.subagentId) {
      const job = this.backgroundJobs.get(item.subagentId)
      if (job) {
        job.status = item.status === "completed" ? "completed" : item.status === "failed" ? "error" : "cancelled"
        job.completedAt = Date.now()
        if (item.status === "failed") job.error = item.output || item.summary || "Sub-agent failed"
      }
    }
    const output = item.output || item.summary || tool.output
    const metadata = {
      ...toolMetadata(tool),
      appServerStatus: item.status,
      appServerTool: item.toolName ?? tool.toolName,
    }
    if (item.status === "failed" || item.status === "declined" || item.status === "interrupted") {
      return [
        toolPartUpdate(
          tool,
          {
            status: "error",
            input: tool.input,
            error: output || (item.status === "declined" ? "Permission declined" : "Tool interrupted"),
          },
          metadata,
        ),
      ]
    }
    return [
      toolPartUpdate(tool, { status: "completed", input: tool.input, output, title: item.label, metadata }, metadata),
    ]
  }

  private interactionStarted(interaction: AppServerInteraction): ExtensionMessage {
    if (this.pendingInteractions.has(interaction.requestId)) {
      throw new Error(`Duplicate CodeM interaction ${interaction.requestId}`)
    }
    this.pendingInteractions.set(interaction.requestId, interaction)
    if (interaction.kind === "permission") {
      return {
        type: "permissionRequest",
        permission: {
          id: interaction.requestId,
          sessionID: interaction.threadId,
          toolName: uiToolName(interaction.toolName),
          patterns: interaction.preview.kind === "bash_command" ? [...interaction.preview.suggestedRules] : [],
          always: interaction.options
            .filter((option) => optionIntent(option.id, option.label) === "allow_always")
            .map((option) => option.id),
          args: permissionArgs(interaction),
          message: interaction.reason,
          ...(interaction.toolCallId
            ? { tool: { messageID: assistantMessageId(interaction.turnId), callID: interaction.toolCallId } }
            : {}),
        },
      }
    }
    return { type: "questionRequest", question: interactionQuestion(interaction) }
  }

  private interactionResolved(
    requestId: string,
    status: "answered" | "cancelled" | "failed",
  ): readonly ExtensionMessage[] {
    const interaction = this.pendingInteractions.get(requestId)
    if (!interaction) return []
    this.pendingInteractions.delete(requestId)
    if (interaction.kind === "permission") {
      return status === "failed"
        ? [{ type: "permissionError", permissionID: requestId }]
        : [{ type: "permissionResolved", permissionID: requestId }]
    }
    return status === "failed"
      ? [{ type: "questionError", requestID: requestId }]
      : [{ type: "questionResolved", requestID: requestId }]
  }

  private turnCompleted(
    event: Extract<AppServerHostEvent, { readonly type: "turn-completed" }>,
  ): readonly ExtensionMessage[] {
    const key = turnKey(event.threadId, event.turnId)
    const view = this.turns.get(key)
    this.turns.delete(key)
    this.hookSequenceByTurn.delete(key)
    for (const [id, tool] of this.toolsByItem) {
      if (tool.threadId === event.threadId && tool.turnId === event.turnId) this.toolsByItem.delete(id)
    }
    for (const [id, tool] of this.toolsByCall) {
      if (tool.threadId === event.threadId && tool.turnId === event.turnId) this.toolsByCall.delete(id)
    }
    const reason = event.outcome === "completed" ? "completed" : event.outcome === "stopped" ? "interrupted" : "error"
    return [
      // Upsert metadata only: the Webview preserves already-streamed parts.
      // Live terminal authority settles rendering without waiting for JSONL.
      ...(view
        ? ([{ type: "messageCreated", message: assistantMessage(event.threadId, view, Date.now()) }] as const)
        : []),
      { type: "sessionStatus", sessionID: event.threadId, status: "idle" },
      { type: "sessionTurnClosed", sessionID: event.threadId, eventID: event.turnId, reason },
      ...(event.error ? ([{ type: "error", message: event.error, sessionID: event.threadId }] as const) : []),
    ]
  }

  private backgroundWake(
    event: Extract<AppServerHostEvent, { readonly type: "background-wake" }>,
  ): readonly ExtensionMessage[] {
    this.backgroundTaskIds.add(event.taskId)
    const job = this.backgroundJobs.get(event.taskId)
    if (job) job.background = true
    const tool = this.toolsByCall.get(callKey(event.threadId, event.turnId, event.taskId))
    if (!tool) return []
    tool.background = true
    return [toolPartUpdate(tool, { status: "running", input: tool.input, title: tool.title }, toolMetadata(tool))]
  }

  private hookCompleted(event: Extract<AppServerHostEvent, { readonly type: "hook-completed" }>): ExtensionMessage {
    const view = this.requireTurn(event.threadId, event.turnId)
    const key = turnKey(event.threadId, event.turnId)
    const sequence = (this.hookSequenceByTurn.get(key) ?? 0) + 1
    this.hookSequenceByTurn.set(key, sequence)
    const id = `${event.turnId}:hook:${sequence}`
    const input = { event: event.eventName, tool: event.toolName, command: event.command }
    const state: ToolPart["state"] =
      event.outcome === "success"
        ? { status: "completed", input, output: event.reason, title: `${event.eventName} · ${event.elapsedMs} ms` }
        : { status: "error", input, error: event.reason || `Hook ${event.outcome}` }
    return {
      type: "partUpdated",
      sessionID: event.threadId,
      messageID: view.messageId,
      part: {
        id,
        type: "tool",
        tool: "hook",
        callID: id,
        sessionID: event.threadId,
        messageID: view.messageId,
        state,
        metadata: { appServerHook: true, outcome: event.outcome, elapsedMs: event.elapsedMs },
      },
    }
  }

  private sideQuestionCompleted(
    event: Extract<AppServerHostEvent, { readonly type: "side-question-completed" }>,
  ): readonly ExtensionMessage[] {
    const question = this.sideQuestions.get(event.sideQuestionId)
    if (!question) return []
    this.sideQuestions.delete(event.sideQuestionId)
    return event.status === "completed"
      ? [{ type: "enhancePromptResult", requestId: question.operationId, text: question.text }]
      : [
          {
            type: "enhancePromptError",
            requestId: question.operationId,
            error: event.error ?? `CodeM prompt enhancement ${event.status}`,
          },
        ]
  }

  private requireTurn(threadId: string, turnId: string): TurnView {
    const key = turnKey(threadId, turnId)
    let view = this.turns.get(key)
    if (!view) {
      view = { messageId: assistantMessageId(turnId), startedAt: new Date().toISOString() }
      this.turns.set(key, view)
    }
    return view
  }

  private requireInteraction<Kind extends AppServerInteraction["kind"]>(
    requestId: string,
    kind: Kind,
  ): Extract<AppServerInteraction, { readonly kind: Kind }> {
    const interaction = this.pendingInteractions.get(requestId)
    if (!interaction || interaction.kind !== kind) throw new Error(`CodeM interaction ${requestId} is not ${kind}`)
    return interaction as Extract<AppServerInteraction, { readonly kind: Kind }>
  }
}

function threadToSession(thread: AppServerThreadSummary): SessionInfo {
  return {
    id: thread.id,
    title: thread.preview || "New conversation",
    createdAt: thread.startedAt,
    updatedAt: thread.startedAt,
  }
}

function historyMessages(
  threadId: string,
  turns: readonly AppServerTurnSummary[],
  items: readonly AppServerHistoryItem[],
): Message[] {
  const byTurn = new Map<string, AppServerHistoryItem[]>()
  for (const item of items) {
    if (!item.turnId) continue
    const entries = byTurn.get(item.turnId) ?? []
    entries.push(item)
    byTurn.set(item.turnId, entries)
  }
  const messages: Message[] = []
  for (const turn of turns) {
    const entries = (byTurn.get(turn.id) ?? []).sort(
      (left, right) => (left.recordSeq ?? Number.MAX_SAFE_INTEGER) - (right.recordSeq ?? Number.MAX_SAFE_INTEGER),
    )
    const user = entries.find((item) => item.type === "userMessage")
    messages.push({
      id: turn.submissionId ?? user?.id ?? `${turn.id}:user`,
      sessionID: threadId,
      role: "user",
      content: user?.text || turn.input,
      createdAt: turn.startedAt,
    })
    const parts = historyParts(entries)
    if (parts.length > 0) {
      messages.push({
        ...assistantMessage(
          threadId,
          { messageId: assistantMessageId(turn.id), startedAt: turn.startedAt },
          turn.completedAt ? Date.parse(turn.completedAt) : undefined,
        ),
        parts: parts.map((part) => ({ ...part, sessionID: threadId, messageID: assistantMessageId(turn.id) })),
      })
    }
  }
  return messages
}

function historyParts(items: readonly AppServerHistoryItem[]): Part[] {
  const results = new Map<string, AppServerHistoryItem>()
  for (const item of items) {
    if (item.type === "toolResult" && item.callId) results.set(item.callId, item)
  }
  const matchedResults = new Set<string>()
  const parts = items.flatMap((item) => {
    if (item.type === "toolResult") return []
    const result = item.callId ? results.get(item.callId) : undefined
    if (!result || !isHistoryTool(item)) return historyPart(item)
    matchedResults.add(result.id)
    return historyPart({
      ...item,
      status: result.status,
      output: result.output || item.output,
      summary: result.summary || item.summary,
      isError: result.isError,
    })
  })
  for (const item of items) {
    if (item.type !== "toolResult" || matchedResults.has(item.id)) continue
    parts.push(...historyPart(item))
  }
  return parts
}

function isHistoryTool(item: AppServerHistoryItem): boolean {
  return (
    item.type !== "userMessage" &&
    item.type !== "agentMessage" &&
    item.type !== "reasoning" &&
    item.type !== "contextCompaction" &&
    item.type !== "toolResult"
  )
}

function historyPart(item: AppServerHistoryItem): Part[] {
  if (item.type === "userMessage") return []
  if (item.type === "agentMessage") return item.text ? [{ id: item.id, type: "text", text: item.text }] : []
  if (item.type === "reasoning") return item.text ? [{ id: item.id, type: "reasoning", text: item.text }] : []
  if (item.type === "contextCompaction") return [{ id: item.id, type: "compaction", auto: true }]
  const tool = uiToolName(item.toolName ?? item.type)
  const input = { ...(item.input ?? {}) }
  const output = item.output || item.summary
  const metadata = { appServerStatus: item.status, appServerTool: item.toolName ?? item.type }
  const state: ToolPart["state"] =
    item.status === "failed" || item.status === "declined" || item.status === "interrupted"
      ? { status: "error", input, error: output || item.status }
      : { status: "completed", input, output, title: item.label, metadata }
  const result: Part[] = [{ id: item.id, type: "tool", tool, callID: item.callId ?? item.id, state, metadata }]
  if (item.finalAnswer && item.status === "completed") {
    result.push({
      id: `${item.id}:summary`,
      type: "text",
      text: item.finalAnswer.summary,
      metadata: {
        appServerFinalAnswer: true,
        status: item.finalAnswer.status,
        kind: item.finalAnswer.kind,
        artifactCount: item.finalAnswer.artifacts.length,
      },
    })
  }
  return result
}

function uiToolInput(item: AppServerItem): Record<string, unknown> {
  const input = { ...(item.input ?? {}) }
  if (item.type !== "subagent") return input
  return {
    ...input,
    description: item.label,
    ...(item.subagentKind ? { subagent_type: item.subagentKind } : {}),
  }
}

function toolMetadata(tool: ToolView): Record<string, unknown> {
  return {
    ...(tool.diff ? { filediff: tool.diff } : {}),
    ...(tool.guard ? { guard: tool.guard } : {}),
    ...(tool.toolName === "task"
      ? { sessionId: tool.callId, background: tool.background, parentSessionId: tool.threadId }
      : {}),
  }
}

function backgroundJobInfo(job: BackgroundJobView): BackgroundJobInfo {
  return {
    id: job.id,
    type: "task",
    title: job.title,
    status: job.status,
    started_at: job.startedAt,
    ...(job.completedAt === undefined ? {} : { completed_at: job.completedAt }),
    ...(job.error ? { error: job.error } : {}),
    metadata: {
      parentSessionId: job.threadId,
      sessionId: job.id,
      background: true,
    },
  }
}

function toolPartUpdate(
  tool: ToolView,
  state: ToolPart["state"],
  metadata?: Record<string, unknown>,
): ExtensionMessage {
  return {
    type: "partUpdated",
    sessionID: tool.threadId,
    messageID: tool.messageId,
    part: {
      id: tool.itemId,
      type: "tool",
      tool: tool.toolName,
      callID: tool.callId,
      sessionID: tool.threadId,
      messageID: tool.messageId,
      state,
      ...(metadata ? { metadata } : {}),
    },
  }
}

function interactionQuestion(
  interaction: Exclude<AppServerInteraction, { readonly kind: "permission" }>,
): Extract<ExtensionMessage, { readonly type: "questionRequest" }>["question"] {
  if (interaction.kind === "question") {
    return {
      id: interaction.requestId,
      sessionID: interaction.threadId,
      blocking: true,
      questions: interaction.questions.map((question) => ({
        question: question.question,
        header: question.header,
        multiple: question.allowsMultipleSelection,
        custom: true,
        options: question.options.map((option) => ({ label: option.label, description: option.description })),
      })),
    }
  }
  if (interaction.kind === "plan") {
    return {
      id: interaction.requestId,
      sessionID: interaction.threadId,
      blocking: true,
      tone: "warning",
      questions: [
        {
          header: "Plan approval",
          question: interaction.plan,
          options: [
            { label: "Approve", description: "Run this plan." },
            { label: "Reject", description: "Return to planning." },
          ],
        },
      ],
    }
  }
  if (interaction.kind === "plan-mode") {
    return {
      id: interaction.requestId,
      sessionID: interaction.threadId,
      blocking: true,
      questions: [
        {
          header: "Plan ready",
          question: "Start implementing the approved plan?",
          options: [
            { label: "Approve", description: "Start implementation." },
            { label: "Reject", description: "Keep planning." },
          ],
        },
      ],
    }
  }
  return {
    id: interaction.requestId,
    sessionID: interaction.threadId,
    blocking: true,
    questions: [
      {
        header: "Checkpoint",
        question: "Choose the checkpoint to restore.",
        options: interaction.checkpoints.map((checkpoint) => ({
          label: checkpoint.id,
          description: checkpoint.warning ?? checkpoint.label,
        })),
      },
      {
        header: "Restore scope",
        question: "Choose what to rewind.",
        options: interaction.modes.map((mode) => ({ label: mode, description: rewindDescription(mode) })),
      },
    ],
  }
}

function permissionArgs(
  interaction: Extract<AppServerInteraction, { readonly kind: "permission" }>,
): Record<string, unknown> {
  const preview = interaction.preview
  if (preview.kind === "bash_command") {
    return { command: preview.command, cwd: preview.cwd, risk: preview.risk, rules: [...preview.suggestedRules] }
  }
  if (preview.kind === "file_write") {
    return {
      filepath: preview.path,
      description: preview.changeSummary,
      ...(preview.diffExcerpt ? { diff: preview.diffExcerpt } : {}),
    }
  }
  if (preview.kind === "file_read") return { filepath: preview.path, access: preview.access }
  if (preview.kind === "mcp") {
    return { server: preview.server, tool: preview.originalTool, arguments: preview.argsRedacted }
  }
  if (preview.kind === "web_fetch") return { url: preview.url, host: preview.host }
  if (preview.kind === "web_search") return { query: preview.query }
  return { description: preview.summary }
}

function legacyFileDiff(diff: AppServerFileDiff): PermissionFileDiff {
  return {
    file: diff.path,
    patch: unifiedPatch(diff),
    additions: diff.stats.linesAdded,
    deletions: diff.stats.linesRemoved,
    status: diff.changeType === "new" ? "added" : diff.changeType === "deleted" ? "deleted" : "modified",
  }
}

function unifiedPatch(diff: AppServerFileDiff): string | undefined {
  if (diff.preview.kind === "raw-partial") return diff.preview.text
  if (diff.preview.kind !== "complete" && diff.preview.kind !== "partial") return undefined
  const body = diff.preview.hunks.flatMap((hunk) => [
    `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    ...hunk.lines.map((line) => `${line.kind === "insert" ? "+" : line.kind === "delete" ? "-" : " "}${line.text}`),
  ])
  return [`--- a/${diff.path}`, `+++ b/${diff.path}`, ...body].join("\n")
}

function optionIntent(id: string, label: string): "allow_once" | "allow_always" | "reject_once" | "other" {
  const value = `${id} ${label}`.toLowerCase().replace(/[ -]+/gu, "_")
  if (value.includes("allow_always") || value.includes("always_allow")) return "allow_always"
  if (value.includes("allow_once") || value.includes("approve_once")) return "allow_once"
  if (value.includes("reject") || value.includes("deny")) return "reject_once"
  return "other"
}

function uiToolName(tool: string): string {
  const aliases: Readonly<Record<string, string>> = {
    run_bash: "bash",
    read_file: "read",
    write_file: "write",
    edit_file: "edit",
    web_fetch: "webfetch",
    web_search: "websearch",
    dispatch: "task",
  }
  return aliases[tool] ?? tool
}

function appendToolOutput(current: string, delta: string): string {
  const combined = `${current}${delta}`
  const lines = combined
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .slice(-4)
  const tail = lines.join("\n")
  return tail.length <= 4_000 ? tail : tail.slice(-4_000)
}

function lastNonEmptyLine(value: string): string | null {
  return (
    value
      .split(/\r?\n/u)
      .filter((line) => line.trim())
      .at(-1) ?? null
  )
}

function rewindDescription(mode: "code" | "conversation" | "both"): string {
  if (mode === "code") return "Restore workspace files only."
  if (mode === "conversation") return "Restore conversation state only."
  return "Restore both workspace files and conversation state."
}

function assistantMessageId(turnId: string): string {
  return `${turnId}:assistant`
}

function turnKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

function itemKey(threadId: string, turnId: string, itemId: string): string {
  return `${turnKey(threadId, turnId)}\u0000${itemId}`
}

function callKey(threadId: string, turnId: string, callId: string): string {
  return `${turnKey(threadId, turnId)}\u0000${callId}`
}
