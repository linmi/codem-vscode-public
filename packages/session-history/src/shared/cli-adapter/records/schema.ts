import {
  addConversationUsage,
  assertValidCodeMSessionId,
  terminalTurnLifecycle,
  type ConversationAttachment,
  type ConversationTurn,
  type ConversationUsage,
  type TodoSnapshot,
} from "../../session/index.ts"
import {
  type BackgroundTaskRegistry,
  cloneBackgroundLifecycle,
  createBackgroundLifecycle,
  interruptOpenBackgroundTasks,
  type MutableBackgroundLifecycle,
  restoreBackgroundRegistry,
  type SealedTurnRevisionSink,
  serializeBackgroundRegistry,
  type SerializedBackgroundTask,
} from "./background/model.ts"
import {
  parseBackgroundCompletion,
  readBackgroundCompletionIndex,
} from "./background/completion-index.ts"
import { parseHookExecution } from "./hook-execution.ts"
import {
  lastSessionRecordLine,
  sessionFileError,
  visitSessionJsonLines,
} from "./jsonl.ts"
import { applyTodoRecord, cloneTodoSnapshot } from "./todo.ts"
import { appendTodoAudit } from "./todo-audit.ts"
import { parseLegacyUserMessage } from "./user-message.ts"
import { requireNonEmptyString, requireTimestamp } from "./fields.ts"
import {
  appendHookExecution,
  createMutableTurn,
  freezeTurn,
  type MutableConversationTurn,
  type PendingTurnHook,
  requireCurrentTurn,
  restoreMutableTurn,
  serializeMutableTurn,
  type SerializedMutableTurn,
} from "./turn/model.ts"
import { turnRecordHandler } from "./turn/records.ts"
import {
  type RecordSequenceMode,
  validateRecordSequence,
} from "./record-sequence.ts"
import { appendDecodedReasoning } from "./turn/reasoning.ts"
import type {
  CodeMConversationProjectionPort,
  CodeMConversationTurnProjectionInput,
  CodeMTurnInitialSubmission,
} from "./projection-port.ts"
import {
  codeMCwdsEqual,
  parseBackgroundHeader,
  parseHeader,
  type BackgroundTaskRecordIdentity,
  type ConversationReducerIdentity,
  type ExpectedSessionIdentity,
  type SessionHeader,
} from "./cwd.ts"
import { CODEM_CORE_SESSION_RECORD_TYPES } from "./contract.ts"
import { parseKnownMetadataRecordDisposition } from "./metadata-disposition.ts"
import { parseUserInvocation, validateHiddenModelInput } from "./user-invocation.ts"

const INTERNAL_USER_MESSAGE_ORIGINS = new Set([
  'ask_user_input',
  'hook_feedback',
  'synthetic',
])

export interface ConversationFileStreamSummary {
  readonly header: SessionHeader | null
  readonly title: string | null
  readonly state: ConversationTurn['state']
  readonly completedAt: string | null
  readonly model: string | null
  readonly provider: string | null
  readonly todoSnapshot: TodoSnapshot | null
  readonly usage: ConversationUsage | null
  readonly backgroundLifecycle: MutableBackgroundLifecycle | null
}
export type ConversationTurnVisitor = (
  turn: ConversationTurn,
  initialSubmission: CodeMTurnInitialSubmission,
) => void | Promise<void>

export async function visitSessionTurns(
  path: string,
  expectedIdentity: ExpectedSessionIdentity,
  visit: ConversationTurnVisitor,
  signal: AbortSignal | null,
): Promise<ConversationFileStreamSummary> {
  return visitConversationFile(path, expectedIdentity, visit, signal)
}

export async function visitBackgroundTaskTurns(
  path: string,
  identity: BackgroundTaskRecordIdentity,
  visit: ConversationTurnVisitor,
  signal: AbortSignal | null,
): Promise<ConversationFileStreamSummary> {
  assertValidCodeMSessionId(identity.taskId)
  return visitConversationFile(
    path,
    { kind: 'background-task', ...identity },
    visit,
    signal,
  )
}

async function visitConversationFile(
  path: string,
  identity: ConversationReducerIdentity,
  visit: ConversationTurnVisitor,
  signal: AbortSignal | null,
): Promise<ConversationFileStreamSummary> {
  const clearedLine = await lastSessionRecordLine(path, 'cleared', signal)
  const backgroundCompletions = await readBackgroundCompletionIndex(
    path,
    (record, lineNumber) => parseBackgroundCompletion(record, path, lineNumber),
    signal,
    clearedLine === null ? 1 : clearedLine + 1,
  )
  const reducer = new ConversationReducer({
    path,
    identity,
    clearedLine,
    backgroundCompletions,
    visit,
  })
  await visitSessionJsonLines(
    path,
    (record, lineNumber) => reducer.applyRecord(record, lineNumber),
    signal,
  )
  return reducer.finish()
}

export interface ConversationReducerOptions<ProjectionState, ProjectionDelta, ProjectionRevision> {
  readonly path: string
  readonly identity: ConversationReducerIdentity
  readonly clearedLine: number | null
  readonly backgroundCompletions: ReadonlyMap<
    string,
    ReturnType<typeof parseBackgroundCompletion>
  >
  readonly visit: ConversationTurnVisitor
  // Present only on the incremental projection path. Whole-file and background
  // reads remain pure CodeM-record-to-session projections.
  readonly projection?: CodeMConversationProjectionPort<
    ProjectionState,
    ProjectionDelta,
    ProjectionRevision
  >
}

/**
 * Typed, bounded, JSON-serializable routing checkpoint (design §7.2). It holds
 * only what the reducer needs to resume an incremental parse across an ingest
 * slice boundary: the single open turn's routing aggregate, the bounded
 * structural-emitter state (§5.3 exchange grouping) and the seen background/child
 * task set. Its size is bounded by one open turn plus the task set, never by the
 * session length. It is versioned by the source's `parser_version`; a version
 * change invalidates it and forces a full rebuild.
 */
export interface ConversationReducerContext<ProjectionState = unknown> {
  readonly recordSequenceMode: RecordSequenceMode
  readonly lastRecordSeq: number | null
  readonly header: SessionHeader | null
  readonly backgroundHeader: SessionHeader | null
  readonly title: string | null
  readonly activeModel: string | null
  readonly activeProvider: string | null
  readonly activeContextHasTurn: boolean
  readonly currentTurn: SerializedMutableTurn | null
  readonly pendingTurnHooks: readonly PendingTurnHook[]
  readonly sawBackgroundUserMessage: boolean
  readonly turnCount: number
  readonly lastTurnModel: string | null
  readonly lastTurnProvider: string | null
  readonly lastTurnState: ConversationTurn['state'] | null
  readonly lastTurnCompletedAt: string | null
  readonly usage: ConversationUsage | null
  readonly todoSnapshot: TodoSnapshot | null
  readonly backgroundTasks: readonly SerializedBackgroundTask[]
  readonly backgroundLifecycle: MutableBackgroundLifecycle | null
  // Consumer-owned bounded projection checkpoint. Null on whole-file reads.
  readonly projection: ProjectionState | null
}

/**
 * The single conversation routing state machine. It is the one place that owns
 * the canonical read model: header boundaries, synthetic user-message
 * suppression, hook prelude buffering, the `cleared` replay cutoff and every turn
 * record handler. Every origin-null user_message opens its own turn; continuation
 * grouping is a structural concern resolved from durable correlation facts, not a
 * routing swallow. `visitConversationFile` drives it over a whole file; the
 * incremental catalog ingest drives it over a tail slice and checkpoints its
 * bounded routing state. There is no second routing implementation.
 */
export class ConversationReducer<
  ProjectionState = unknown,
  ProjectionDelta = unknown,
  ProjectionRevision = unknown,
> {
  private readonly path: string
  private readonly identity: ConversationReducerIdentity
  private readonly clearedLine: number | null
  private readonly backgroundCompletions: ConversationReducerOptions<
    ProjectionState,
    ProjectionDelta,
    ProjectionRevision
  >['backgroundCompletions']
  private readonly visit: ConversationTurnVisitor
  private readonly conversationId: string
  private readonly backgroundLifecycle: MutableBackgroundLifecycle | null
  private readonly projection: CodeMConversationProjectionPort<
    ProjectionState,
    ProjectionDelta,
    ProjectionRevision
  > | null
  private projectionState: ProjectionState | null
  private projectionDeltas: ProjectionDelta[] = []
  // §8.2 late-background revisions for this slice; drained with the deltas, never
  // part of the persisted checkpoint (a crash before commit re-emits them on replay).
  private projectionTurnRevisions: ProjectionRevision[] = []

  private backgroundTasks: BackgroundTaskRegistry = new Map()
  private todoSnapshot: TodoSnapshot | null = null
  private recordSequenceMode: RecordSequenceMode = 'undetermined'
  private lastRecordSeq: number | null = null
  private header: SessionHeader | null = null
  private backgroundHeader: SessionHeader | null = null
  private title: string | null = null
  private activeModel: string | null = null
  private activeProvider: string | null = null
  private activeContextHasTurn = false
  private currentTurn: MutableConversationTurn | null = null
  private pendingTurnHooks: PendingTurnHook[] = []
  private sawBackgroundUserMessage = false
  private turnCount = 0
  private lastTurnModel: string | null = null
  private lastTurnProvider: string | null = null
  private lastTurnState: ConversationTurn['state'] | null = null
  private lastTurnCompletedAt: string | null = null
  private usage: ConversationUsage | null = null

  constructor(options: ConversationReducerOptions<
    ProjectionState,
    ProjectionDelta,
    ProjectionRevision
  >) {
    this.path = options.path
    this.identity = options.identity
    this.clearedLine = options.clearedLine
    this.backgroundCompletions = options.backgroundCompletions
    this.visit = options.visit
    this.projection = options.projection ?? null
    this.projectionState = this.projection?.initialState() ?? null
    this.backgroundLifecycle = options.identity.kind === 'background-task'
      ? createBackgroundLifecycle()
      : null
    this.conversationId = options.identity.kind === 'background-task'
      ? `${options.identity.rootSessionId}:background:${options.identity.taskId}`
      : options.identity.sessionId
    if (options.identity.kind === 'background-task') {
      this.activeModel = options.identity.fallbackModel
    }
  }

  async applyRecord(
    record: Record<string, unknown>,
    lineNumber: number,
  ): Promise<void> {
    const identity = this.identity
    const path = this.path
    const sequenced = validateRecordSequence(
      record,
      { mode: this.recordSequenceMode, last: this.lastRecordSeq },
      path,
      lineNumber,
    )
    record = sequenced.record
    this.recordSequenceMode = sequenced.state.mode
    this.lastRecordSeq = sequenced.state.last
    if (
      lineNumber === 1 &&
      identity.kind !== 'background-task' &&
      record.type !== 'header'
    ) {
      throw sessionFileError(path, lineNumber, 'first record must be a header')
    }
    if (record.type === 'header') {
      const parsedHeader = identity.kind === 'background-task'
        ? parseBackgroundHeader(record, path, lineNumber, identity)
        : parseHeader(record, path, lineNumber, identity)
      const initialHeader = identity.kind === 'background-task'
        ? this.backgroundHeader
        : this.header
      if (
        initialHeader &&
        !codeMCwdsEqual(parsedHeader.cwd, initialHeader.cwd)
      ) {
        throw sessionFileError(
          path,
          lineNumber,
          `resume header cwd ${parsedHeader.cwd} does not match initial header cwd ${initialHeader.cwd}`,
        )
      }
      this.stopActiveTurnAt(parsedHeader.startedAt)
      this.convergeOpenBackgroundTasks(parsedHeader.startedAt)
      await this.emitCurrentTurn()
      if (identity.kind === 'background-task') {
        this.backgroundHeader ??= parsedHeader
      } else {
        this.header ??= parsedHeader
      }
      this.activeModel = parsedHeader.model
      this.activeProvider = parsedHeader.provider
      this.activeContextHasTurn = false
      return
    }
    if (record.type === 'cleared') {
      if (Object.keys(record).length !== 1) {
        throw sessionFileError(path, lineNumber, 'cleared contains unsupported fields')
      }
      return
    }
    if (
      this.clearedLine !== null &&
      lineNumber < this.clearedLine &&
      record.type !== 'session_renamed' &&
      record.type !== 'project_switched'
    ) {
      return
    }
    const todoState = { todoSnapshot: this.todoSnapshot }
    const todoAudit = applyTodoRecord(todoState, record, path, lineNumber)
    if (todoAudit) {
      this.todoSnapshot = todoState.todoSnapshot
      appendTodoAudit(
        requireCurrentTurn(this.currentTurn, path, lineNumber, 'Todo mutation'),
        todoAudit,
        path,
        lineNumber,
      )
      return
    }

    if (record.type === 'session_renamed') {
      this.title = requireNonEmptyString(
        record.new_title,
        path,
        lineNumber,
        'new_title',
      )
      requireTimestamp(record.at, path, lineNumber, 'at')
      return
    }

    if (record.type === 'user_message') {
      await this.routeUserMessage(record, lineNumber)
      if (identity.kind === 'background-task' && this.currentTurn) {
        this.sawBackgroundUserMessage = true
      }
      return
    }
    if (record.type === 'user_invocation') {
      await this.routeUserInvocation(record, lineNumber)
      if (identity.kind === 'background-task' && this.currentTurn) {
        this.sawBackgroundUserMessage = true
      }
      return
    }
    if (record.type === 'model_input') {
      validateHiddenModelInput(
        record,
        this.currentTurn?.initialSubmission ?? null,
        path,
        lineNumber,
      )
      return
    }
    if (record.type === 'hook_execution') {
      this.routeHookExecution(record, lineNumber)
      return
    }

    const metadataDisposition = parseKnownMetadataRecordDisposition(
      record,
      path,
      lineNumber,
    )
    if (metadataDisposition) {
      if (metadataDisposition.disposition === 'projected-redaction') {
        appendDecodedReasoning(
          requireCurrentTurn(
            this.currentTurn,
            path,
            lineNumber,
            'redacted thinking',
          ),
          { kind: 'redacted' },
          metadataDisposition.at,
        )
      }
      return
    }

    const handler = turnRecordHandler(record.type)
    if (!handler) {
      if (
        typeof record.type === 'string' &&
        CODEM_CORE_SESSION_RECORD_TYPES.includes(record.type)
      ) {
        throw sessionFileError(
          path,
          lineNumber,
          `known record ${record.type} has no adapter disposition`,
        )
      }
      // SessionRecord is an append-only external protocol: a new producer may
      // add projection-optional records before Desktop is upgraded. Existing
      // record names and fields remain the compatibility boundary. Only unknown
      // variants reach this extension no-op; every pinned record is handled or
      // explicitly validated and discarded above.
      return
    }
    // Historical background streams can persist startup and prompt hooks before
    // their user_message. Unknown extension metadata was returned above; every
    // known turn-level record still requires an established canonical turn.
    if (identity.kind === 'background-task' && !this.sawBackgroundUserMessage) {
      throw sessionFileError(
        path,
        lineNumber,
        `background task ${handler.label} appears before the first user message`,
      )
    }
    handler.apply(
      requireCurrentTurn(this.currentTurn, path, lineNumber, handler.label),
      record,
      {
        path,
        lineNumber,
        durableSequenceRequired: this.recordSequenceMode === 'sequenced',
        backgroundTasks: this.backgroundTasks,
        backgroundCompletions: this.backgroundCompletions,
        ownBackgroundTask: identity.kind === 'background-task'
          ? { taskId: identity.taskId, lifecycle: this.backgroundLifecycle! }
          : null,
        // Durable-only: a late background record on a sealed turn is a §8.2 revision.
        reviseSealedTurn: this.projection
          ? (projectionTurnId, itemIndex, update) =>
              this.projectionTurnRevisions.push(
                this.projection!.reviseTurn(projectionTurnId, itemIndex, update),
              )
          : null,
      },
    )
  }

  /**
   * Captures the bounded routing state so an incremental ingest can persist it
   * with the durable cursor and resume in a fresh reducer after a crash. Live
   * arrays are copied, so the reducer may keep mutating after a snapshot.
   */
  snapshot(): ConversationReducerContext<ProjectionState> {
    return {
      recordSequenceMode: this.recordSequenceMode,
      lastRecordSeq: this.lastRecordSeq,
      header: this.header,
      backgroundHeader: this.backgroundHeader,
      title: this.title,
      activeModel: this.activeModel,
      activeProvider: this.activeProvider,
      activeContextHasTurn: this.activeContextHasTurn,
      currentTurn: this.currentTurn
        ? serializeMutableTurn(this.currentTurn)
        : null,
      pendingTurnHooks: this.pendingTurnHooks.map((hook) => ({ ...hook })),
      sawBackgroundUserMessage: this.sawBackgroundUserMessage,
      turnCount: this.turnCount,
      lastTurnModel: this.lastTurnModel,
      lastTurnProvider: this.lastTurnProvider,
      lastTurnState: this.lastTurnState,
      lastTurnCompletedAt: this.lastTurnCompletedAt,
      usage: this.usage ? { ...this.usage } : null,
      todoSnapshot: cloneTodoSnapshot(this.todoSnapshot),
      backgroundTasks: serializeBackgroundRegistry(this.backgroundTasks),
      backgroundLifecycle: this.backgroundLifecycle
        ? cloneBackgroundLifecycle(this.backgroundLifecycle)
        : null,
      projection: this.projectionState,
    }
  }

  restore(context: ConversationReducerContext<ProjectionState>): void {
    this.recordSequenceMode = context.recordSequenceMode
    this.lastRecordSeq = context.lastRecordSeq
    this.header = context.header
    this.backgroundHeader = context.backgroundHeader
    this.title = context.title
    this.activeModel = context.activeModel
    this.activeProvider = context.activeProvider
    this.activeContextHasTurn = context.activeContextHasTurn
    this.currentTurn = context.currentTurn
      ? restoreMutableTurn(context.currentTurn)
      : null
    this.pendingTurnHooks = context.pendingTurnHooks.map((hook) => ({ ...hook }))
    this.sawBackgroundUserMessage = context.sawBackgroundUserMessage
    this.turnCount = context.turnCount
    this.lastTurnModel = context.lastTurnModel
    this.lastTurnProvider = context.lastTurnProvider
    this.lastTurnState = context.lastTurnState
    this.lastTurnCompletedAt = context.lastTurnCompletedAt
    this.usage = context.usage ? { ...context.usage } : null
    this.todoSnapshot = cloneTodoSnapshot(context.todoSnapshot)
    // Pass the just-restored open turn so a still-open dispatch task re-hydrates
    // its full lifecycle from that turn's item and keeps mutating it in place.
    this.backgroundTasks = restoreBackgroundRegistry(
      context.backgroundTasks,
      this.currentTurn,
    )
    this.projectionState = context.projection
    if (this.backgroundLifecycle && context.backgroundLifecycle) {
      const restored = cloneBackgroundLifecycle(context.backgroundLifecycle)
      this.backgroundLifecycle.state = restored.state
      this.backgroundLifecycle.progress.splice(
        0,
        this.backgroundLifecycle.progress.length,
        ...restored.progress,
      )
      this.backgroundLifecycle.questions.splice(
        0,
        this.backgroundLifecycle.questions.length,
        ...restored.questions,
      )
      this.backgroundLifecycle.outcome = restored.outcome
      this.backgroundLifecycle.report = restored.report
      this.backgroundLifecycle.summary = restored.summary
      this.backgroundLifecycle.completedAt = restored.completedAt
    }
  }

  async finish(): Promise<ConversationFileStreamSummary> {
    if (
      this.identity.kind === 'background-task' &&
      !this.sawBackgroundUserMessage
    ) {
      throw sessionFileError(
        this.path,
        1,
        'background task requires a user_message record',
      )
    }
    await this.emitCurrentTurn()
    return {
      header: this.header,
      title: this.title,
      state: this.lastTurnState ?? 'completed',
      completedAt: this.lastTurnCompletedAt,
      model: this.activeContextHasTurn ? this.lastTurnModel : this.activeModel,
      provider: this.activeContextHasTurn
        ? this.lastTurnProvider
        : this.activeProvider,
      todoSnapshot: this.todoSnapshot,
      usage: this.usage,
      backgroundLifecycle: this.backgroundLifecycle,
    }
  }

  private async emitCurrentTurn(): Promise<void> {
    if (!this.currentTurn) return
    const mutable = this.currentTurn
    const turn = freezeTurn(mutable)
    this.currentTurn = null
    this.lastTurnModel = turn.model
    this.lastTurnProvider = turn.provider
    this.lastTurnState = turn.state
    this.lastTurnCompletedAt = turn.completedAt
    this.usage = addConversationUsage(this.usage, turn.usage)
    if (this.projection && this.projectionState !== null) {
      const { delta, state } = this.projection.projectTurn(
        this.projectionTurnInput(mutable, turn.state),
        this.projectionState,
      )
      this.projectionState = state
      this.projectionDeltas.push(delta)
    }
    await this.visit(turn, mutable.initialSubmission)
  }

  private projectionTurnInput(
    mutable: MutableConversationTurn,
    state: ConversationTurn['state'],
  ): CodeMConversationTurnProjectionInput {
    return {
      sessionId: this.conversationId,
      turnId: mutable.id,
      index: mutable.index,
      initialSubmission: mutable.initialSubmission,
      engineTurns: mutable.engineTurns,
      engineTurnIndexes: mutable.engineTurnIndexes,
      items: mutable.items,
      model: mutable.model,
      provider: mutable.provider,
      startedAt: mutable.startedAt,
      state,
      completedAt: mutable.lifecycle.completedAt,
      usage: mutable.usage,
      terminal: state !== 'running' && state !== 'waiting-interaction',
    }
  }

  // Emits the still-open tail turn's structural delta at EOF over a COPY of the
  // state (never mutating it): a non-terminal tail yields its `open` exchange,
  // active segment identity and payload; a terminal tail yields its full sealed
  // rows. The active segment/payload upsert when a later append seals the turn.
  previewTailStructural(): void {
    if (!this.projection || this.projectionState === null || !this.currentTurn) return
    const { delta } = this.projection.projectTurn(
      this.projectionTurnInput(this.currentTurn, this.currentTurn.lifecycle.state),
      this.projectionState,
    )
    this.projectionDeltas.push(delta)
  }

  // Drains the deltas produced since the last drain; the caller commits them in
  // the same transaction as the slice cursor.
  takeStructuralDeltas(): readonly ProjectionDelta[] {
    const deltas = this.projectionDeltas
    this.projectionDeltas = []
    return deltas
  }

  // Drains this slice's §8.2 turn revisions (order preserved so sequential updates to
  // one turn apply cumulatively); committed in the same transaction as the deltas.
  takeTurnRevisions(): readonly ProjectionRevision[] {
    const revisions = this.projectionTurnRevisions
    this.projectionTurnRevisions = []
    return revisions
  }

  private stopActiveTurnAt(completedAt: string): boolean {
    if (this.currentTurn?.lifecycle.completedAt === null) {
      this.currentTurn.lifecycle = terminalTurnLifecycle('stopped', completedAt)
      return true
    }
    return false
  }

  // A dead run's still-open background tasks are orphaned when a new run takes over:
  // seal them as `interrupted`. Tasks whose dispatch turn is the open turn update in
  // place before it emits; tasks on sealed prior turns drive a §8.2 durable revision.
  private convergeOpenBackgroundTasks(at: string): void {
    const sink: SealedTurnRevisionSink | null = this.projection
      ? {
          openTurnId: this.currentTurn?.id ?? '',
          emit: (projectionTurnId, itemIndex, update) =>
            this.projectionTurnRevisions.push(
              this.projection!.reviseTurn(projectionTurnId, itemIndex, update),
            ),
        }
      : null
    interruptOpenBackgroundTasks(this.backgroundTasks, at, sink)
  }

  private async beginUserTurn(
    record: Record<string, unknown>,
    lineNumber: number,
  ): Promise<void> {
    const parsed = parseLegacyUserMessage(record, this.path, lineNumber)
    if (!parsed) {
      this.pendingTurnHooks.splice(0)
      return
    }
    await this.openUserTurn(
      parsed.startedAt,
      parsed.text,
      parsed.attachments,
      { source: 'legacy-user-message' },
    )
  }

  private async routeUserInvocation(
    record: Record<string, unknown>,
    lineNumber: number,
  ): Promise<void> {
    const parsed = parseUserInvocation(record, this.path, lineNumber)
    await this.openUserTurn(
      parsed.startedAt,
      parsed.text,
      parsed.attachments,
      parsed.initialSubmission,
    )
  }

  private async openUserTurn(
    startedAt: string,
    text: string,
    attachments: readonly ConversationAttachment[],
    initialSubmission: CodeMTurnInitialSubmission,
  ): Promise<void> {
    if (this.stopActiveTurnAt(startedAt)) {
      this.convergeOpenBackgroundTasks(startedAt)
    }
    await this.emitCurrentTurn()
    const turn = createMutableTurn(
      this.conversationId,
      this.turnCount,
      initialSubmission,
      startedAt,
      this.activeModel,
      this.activeProvider,
    )
    turn.items.push({
      id: `${turn.id}:user`,
      kind: 'message',
      role: 'user',
      text,
      attachments,
      at: turn.startedAt,
    })
    for (const hook of this.pendingTurnHooks.splice(0)) {
      appendHookExecution(turn, hook)
    }
    this.currentTurn = turn
    this.activeContextHasTurn = true
    this.turnCount += 1
  }

  private async routeUserMessage(
    record: Record<string, unknown>,
    lineNumber: number,
  ): Promise<void> {
    const path = this.path
    if (record.origin === undefined || record.origin === null) {
      // Every origin-null user_message opens its own turn. Question replies are
      // grouped into their owning exchange by durable correlation facts in the
      // structural emitter, not swallowed here.
      await this.beginUserTurn(record, lineNumber)
      return
    }
    const origin = requireNonEmptyString(
      record.origin,
      path,
      lineNumber,
      'origin',
    )
    if (!INTERNAL_USER_MESSAGE_ORIGINS.has(origin)) {
      throw sessionFileError(
        path,
        lineNumber,
        `unsupported user message origin ${origin}`,
      )
    }
    requireNonEmptyString(record.content, path, lineNumber, 'content')
    requireTimestamp(record.at, path, lineNumber, 'at')
    requireCurrentTurn(
      this.currentTurn,
      path,
      lineNumber,
      `internal user message ${origin}`,
    )
  }

  // SessionStart 不属于任何轮次；UserPromptSubmit 先于所属轮次出现，缓存到轮次建立后挂载。
  private routeHookExecution(
    record: Record<string, unknown>,
    lineNumber: number,
  ): void {
    const path = this.path
    const hook = parseHookExecution(record, path, lineNumber)
    if (hook.eventName === 'SessionStart') return
    if (hook.eventName === 'UserPromptSubmit') {
      this.pendingTurnHooks.push({ lineNumber, item: hook })
      return
    }
    appendHookExecution(
      requireCurrentTurn(
        this.currentTurn,
        path,
        lineNumber,
        `hook execution ${hook.eventName || '(unnamed)'}`,
      ),
      { lineNumber, item: hook },
    )
  }
}
