import type {
  ConversationBackgroundTask,
  ConversationItem,
} from "../../../session/index.ts"
import { sessionFileError } from "../jsonl.ts"
import {
  requireNonEmptyString,
  requireString,
  requireTimestamp,
  summarize,
} from "../fields.ts"
import type { BackgroundCompletion } from "./completion-index.ts"

type AnyBackgroundItem = Extract<
  ConversationItem,
  { kind: 'activity'; activityType: 'background' }
>
export type BackgroundItem = Exclude<
  AnyBackgroundItem,
  { readonly origin: 'live-observed' }
>
// The background task lifecycle state — distinct from the top-level thread state:
// `interrupted` marks a task whose dispatching run died, which a session is never.
type BackgroundState = Extract<
  ConversationBackgroundTask,
  { readonly transcriptStatus: 'available' }
>['state']

interface BackgroundTurn {
  readonly id: string
  readonly items: ConversationItem[]
}

export interface BackgroundDispatch {
  readonly taskId: string
  readonly label: string
  readonly prompt: string
  readonly source: string
  readonly at: string
}

export interface BackgroundProgress {
  readonly note: string
  readonly at: string
}

export interface BackgroundQuestion {
  readonly questionId: string
  readonly question: string
  readonly askedAt: string
  readonly reply: string | null
  readonly repliedAt: string | null
}

export interface MutableBackgroundLifecycle {
  state: BackgroundState
  readonly progress: BackgroundProgress[]
  readonly questions: BackgroundQuestion[]
  outcome: string | null
  report: string | null
  summary: string | null
  completedAt: string | null
}

type InvalidBackgroundRecord = (message: string) => Error

interface RegisteredBackgroundTask {
  readonly taskId: string
  readonly origin: 'dispatch-recorded' | 'completion-only'
  readonly turn: BackgroundTurn
  readonly itemIndex: number
  readonly lifecycle: MutableBackgroundLifecycle
  readonly dispatch: BackgroundDispatch | null
  indexedCompletion: BackgroundCompletion | null
  terminalSource: 'done' | 'cancelled' | 'completed' | null
}

export type BackgroundTaskRegistry = Map<string, RegisteredBackgroundTask>

export function createBackgroundLifecycle(): MutableBackgroundLifecycle {
  return {
    state: 'running',
    progress: [],
    questions: [],
    outcome: null,
    report: null,
    summary: null,
    completedAt: null,
  }
}

export function applyOwnBackgroundLifecycleRecord(
  lifecycle: MutableBackgroundLifecycle,
  expectedTaskId: string,
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): boolean {
  if (!isBackgroundLifecycleRecord(record.type)) return false
  const taskId = requireNonEmptyString(
    record.task_id,
    path,
    lineNumber,
    'task_id',
  )
  if (taskId !== expectedTaskId) return false
  applyLifecycleRecord(lifecycle, record, path, lineNumber)
  return true
}

// §8.2 late background record on a sealed dispatch turn: the update replayed
// against that turn's persisted payload item. Raw record / parsed completion mirror
// the two reducer mutation paths so the Writer reuses this module's one item model.
export type BackgroundItemRevisionUpdate =
  | {
      readonly kind: 'lifecycle'
      readonly record: Record<string, unknown>
      readonly path: string
      readonly lineNumber: number
    }
  | { readonly kind: 'completion'; readonly completion: BackgroundCompletion }
  | { readonly kind: 'interrupted'; readonly at: string }

// Emitted when a background record updates a task whose dispatch turn is no longer
// the open turn; `openTurnId` is that current turn (§8.2 seal detection).
export interface SealedTurnRevisionSink {
  readonly openTurnId: string
  readonly emit: (
    turnId: string,
    itemIndex: number,
    update: BackgroundItemRevisionUpdate,
  ) => void
}

export function applyRegisteredBackgroundLifecycleRecord(
  tasks: BackgroundTaskRegistry,
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
  revision?: SealedTurnRevisionSink,
): void {
  const taskId = requireNonEmptyString(
    record.task_id,
    path,
    lineNumber,
    'task_id',
  )
  const task = tasks.get(taskId)
  if (!task) {
    throw sessionFileError(
      path,
      lineNumber,
      `${String(record.type)} ${taskId} has no matching background task`,
    )
  }
  if (!applyLifecycleRecord(task.lifecycle, record, path, lineNumber)) return
  task.terminalSource = backgroundTerminalSource(record.type) ??
    task.terminalSource
  replaceRegisteredItem(task)
  emitSealedTurnRevision(task, { kind: 'lifecycle', record, path, lineNumber }, revision)
}

// A new run taking over the session (resume header / killed-turn boundary) seals every
// still-open background task the dead run left behind as `interrupted`. A task whose
// dispatch turn is already sealed drives a §8.2 revision so its durable row converges too.
export function interruptOpenBackgroundTasks(
  tasks: BackgroundTaskRegistry,
  at: string,
  revision: SealedTurnRevisionSink | null,
): void {
  for (const task of tasks.values()) {
    if (task.lifecycle.completedAt !== null) continue
    task.lifecycle.state = 'interrupted'
    task.lifecycle.completedAt = at
    replaceRegisteredItem(task)
    emitSealedTurnRevision(task, { kind: 'interrupted', at }, revision ?? undefined)
  }
}

export function appendBackgroundDispatch(
  tasks: BackgroundTaskRegistry,
  turn: BackgroundTurn,
  dispatch: BackgroundDispatch,
  completion: BackgroundCompletion | null,
  invalid: InvalidBackgroundRecord,
): void {
  if (tasks.has(dispatch.taskId)) {
    throw invalid(`duplicate background task ${dispatch.taskId}`)
  }
  const lifecycle = createBackgroundLifecycle()
  const itemIndex = turn.items.length
  const task: RegisteredBackgroundTask = {
    taskId: dispatch.taskId,
    origin: 'dispatch-recorded',
    turn,
    itemIndex,
    lifecycle,
    dispatch,
    indexedCompletion: completion,
    terminalSource: null,
  }
  turn.items.push(backgroundItem(task))
  tasks.set(dispatch.taskId, task)
}

export function appendBackgroundCompletion(
  tasks: BackgroundTaskRegistry,
  completionTurn: BackgroundTurn,
  completion: BackgroundCompletion,
  invalid: InvalidBackgroundRecord,
  revision?: SealedTurnRevisionSink,
): void {
  const task = tasks.get(completion.taskId)
  if (!task) {
    appendCompletionOnlyTask(tasks, completionTurn, completion)
    return
  }
  if (task.terminalSource === 'done') {
    if (completion.state !== 'completed') {
      throw invalid(
        `background completion ${completion.taskId} conflicts with successful background_done`,
      )
    }
    applyCompletion(task.lifecycle, completion)
    task.indexedCompletion = null
    task.terminalSource = 'completed'
    replaceRegisteredItem(task)
    emitSealedTurnRevision(task, { kind: 'completion', completion }, revision)
    return
  }
  // Old CLIs persisted shell PIDs as task_id, so a reused numeric ID starts a new
  // occurrence. Remove this once every supported CLI emits launch-unique IDs.
  if (
    task.origin === 'completion-only' &&
    isLegacyShellProcessId(completion.taskId)
  ) {
    appendCompletionOnlyTask(tasks, completionTurn, completion)
    return
  }
  if (task.terminalSource !== null || task.lifecycle.completedAt !== null) {
    throw invalid(`duplicate background result ${completion.taskId}`)
  }
  applyCompletion(task.lifecycle, completion)
  task.indexedCompletion = null
  task.terminalSource = 'completed'
  replaceRegisteredItem(task)
  emitSealedTurnRevision(task, { kind: 'completion', completion }, revision)
}

function appendCompletionOnlyTask(
  tasks: BackgroundTaskRegistry,
  turn: BackgroundTurn,
  completion: BackgroundCompletion,
): void {
  const lifecycle = createBackgroundLifecycle()
  applyCompletion(lifecycle, completion)
  const task: RegisteredBackgroundTask = {
    taskId: completion.taskId,
    origin: 'completion-only',
    turn,
    itemIndex: turn.items.length,
    lifecycle,
    dispatch: null,
    indexedCompletion: null,
    terminalSource: 'completed',
  }
  turn.items.push(backgroundItem(task))
  tasks.set(completion.taskId, task)
}

function isLegacyShellProcessId(taskId: string): boolean {
  return /^\d+$/.test(taskId)
}

// §7.2 bounded per-task status: no per-event progress/answered questions, free text
// capped. `pendingQuestionIds` = unanswered ids a later `background_replied` resolves.
export interface SerializedBackgroundStatus {
  readonly state: BackgroundState
  readonly outcome: string | null
  readonly report: string | null
  readonly summary: string | null
  readonly completedAt: string | null
  readonly pendingQuestionIds: readonly string[]
}

// Bounded by the task-id set, never a task's total activity. A still-open dispatch
// turn re-hydrates its full lifecycle from that turn's item on restore (see below).
export interface SerializedBackgroundTask {
  readonly taskId: string
  readonly origin: RegisteredBackgroundTask['origin']
  readonly turnId: string
  readonly itemIndex: number
  readonly status: SerializedBackgroundStatus
  readonly dispatch: BackgroundDispatch | null
  readonly terminalSource: RegisteredBackgroundTask['terminalSource']
}

function capText(value: string | null): string | null {
  return value === null ? null : summarize(value)
}

export function serializeBackgroundRegistry(
  registry: BackgroundTaskRegistry,
): readonly SerializedBackgroundTask[] {
  return [...registry.values()].map((task) => ({
    taskId: task.taskId,
    origin: task.origin,
    turnId: task.turn.id,
    itemIndex: task.itemIndex,
    status: {
      state: task.lifecycle.state,
      outcome: capText(task.lifecycle.outcome),
      report: capText(task.lifecycle.report),
      summary: capText(task.lifecycle.summary),
      completedAt: task.lifecycle.completedAt,
      pendingQuestionIds: task.lifecycle.questions
        .filter((question) => question.reply === null)
        .map((question) => question.questionId),
    },
    dispatch: task.dispatch
      ? {
          ...task.dispatch,
          label: summarize(task.dispatch.label),
          prompt: summarize(task.dispatch.prompt),
        }
      : null,
    terminalSource: task.terminalSource,
  }))
}

export function restoreBackgroundRegistry(
  serialized: readonly SerializedBackgroundTask[],
  openTurn: BackgroundTurn | null,
): BackgroundTaskRegistry {
  const registry: BackgroundTaskRegistry = new Map()
  for (const entry of serialized) {
    const restored = restoreRegisteredTask(entry, openTurn)
    registry.set(entry.taskId, restored)
  }
  return registry
}

// Open dispatch turn == the single restored open turn: re-hydrate the full live
// lifecycle from its item so the write-back keeps the seal payload whole-file-equal.
// A sealed task restores to bounded status on a detached turn (dead write-back).
function restoreRegisteredTask(
  entry: SerializedBackgroundTask,
  openTurn: BackgroundTurn | null,
): RegisteredBackgroundTask {
  const openItem = openTurn && openTurn.id === entry.turnId
    ? openTurn.items[entry.itemIndex]
    : undefined
  if (
    openTurn && openItem &&
    openItem.kind === 'activity' && openItem.activityType === 'background' &&
    openItem.origin !== 'live-observed' &&
    openItem.taskId === entry.taskId
  ) {
    return {
      taskId: entry.taskId,
      origin: entry.origin,
      turn: openTurn,
      itemIndex: entry.itemIndex,
      lifecycle: lifecycleFromItem(openItem),
      dispatch: dispatchFromItem(entry.taskId, openItem),
      indexedCompletion: null,
      terminalSource: entry.terminalSource,
    }
  }
  return {
    taskId: entry.taskId,
    origin: entry.origin,
    turn: { id: entry.turnId, items: [] },
    itemIndex: entry.itemIndex,
    lifecycle: {
      state: entry.status.state,
      progress: [],
      questions: entry.status.pendingQuestionIds.map((questionId) =>
        pendingQuestionSignature(questionId, entry)),
      outcome: entry.status.outcome,
      report: entry.status.report,
      summary: entry.status.summary,
      completedAt: entry.status.completedAt,
    },
    dispatch: entry.dispatch,
    indexedCompletion: null,
    terminalSource: entry.terminalSource,
  }
}

function lifecycleFromItem(item: BackgroundItem): MutableBackgroundLifecycle {
  return {
    state: item.status,
    progress: item.progress.map((entry) => ({ ...entry })),
    questions: item.questions.map((entry) => ({ ...entry })),
    outcome: item.outcome,
    report: item.report,
    summary: item.summary,
    completedAt: item.completedAt,
  }
}

function dispatchFromItem(
  taskId: string,
  item: BackgroundItem,
): BackgroundDispatch | null {
  if (item.origin !== 'dispatch-recorded') return null
  return {
    taskId,
    label: item.label,
    prompt: item.prompt,
    source: item.source,
    at: item.at,
  }
}

// Only the id and null reply matter (cross-slice reply match + waiting/running
// state); the placeholder body is never projected because the turn is detached.
function pendingQuestionSignature(
  questionId: string,
  entry: SerializedBackgroundTask,
): BackgroundQuestion {
  return {
    questionId,
    question: questionId,
    askedAt: entry.dispatch?.at ?? entry.status.completedAt ?? questionId,
    reply: null,
    repliedAt: null,
  }
}

export function cloneBackgroundLifecycle(
  lifecycle: MutableBackgroundLifecycle,
): MutableBackgroundLifecycle {
  return {
    state: lifecycle.state,
    progress: lifecycle.progress.map((entry) => ({ ...entry })),
    questions: lifecycle.questions.map((entry) => ({ ...entry })),
    outcome: lifecycle.outcome,
    report: lifecycle.report,
    summary: lifecycle.summary,
    completedAt: lifecycle.completedAt,
  }
}

function applyLifecycleRecord(
  lifecycle: MutableBackgroundLifecycle,
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): boolean {
  if (lifecycle.completedAt !== null) {
    // The pinned CLI can race a natural worker completion with a user cancellation:
    // the completion is appended first and a stale cancellation arrives afterwards.
    // Keep the first terminal outcome authoritative at this external protocol
    // boundary. Every other post-terminal lifecycle record remains invalid. Remove
    // this branch once the minimum supported CLI guarantees atomic terminal writes.
    if (
      record.type === 'background_cancelled' &&
      lifecycle.state === 'completed'
    ) {
      requireTimestamp(record.at, path, lineNumber, 'at')
      return false
    }
    throw sessionFileError(
      path,
      lineNumber,
      `${String(record.type)} appears after the background task completed`,
    )
  }
  switch (record.type) {
    case 'background_progress':
      lifecycle.progress.push({
        note: requireNonEmptyString(record.note, path, lineNumber, 'note'),
        at: requireTimestamp(record.at, path, lineNumber, 'at'),
      })
      return true
    case 'background_question': {
      const questionId = requireNonEmptyString(
        record.question_id,
        path,
        lineNumber,
        'question_id',
      )
      if (lifecycle.questions.some((item) => item.questionId === questionId)) {
        throw sessionFileError(
          path,
          lineNumber,
          `duplicate background question ${questionId}`,
        )
      }
      lifecycle.questions.push({
        questionId,
        question: requireNonEmptyString(
          record.question,
          path,
          lineNumber,
          'question',
        ),
        askedAt: requireTimestamp(record.at, path, lineNumber, 'at'),
        reply: null,
        repliedAt: null,
      })
      lifecycle.state = 'waiting-interaction'
      return true
    }
    case 'background_replied': {
      const questionId = requireNonEmptyString(
        record.question_id,
        path,
        lineNumber,
        'question_id',
      )
      const questionIndex = lifecycle.questions.findIndex(
        (item) => item.questionId === questionId,
      )
      const question = lifecycle.questions[questionIndex]
      if (!question) {
        throw sessionFileError(
          path,
          lineNumber,
          `background reply ${questionId} has no matching question`,
        )
      }
      if (question.reply !== null) {
        throw sessionFileError(
          path,
          lineNumber,
          `duplicate background reply ${questionId}`,
        )
      }
      lifecycle.questions[questionIndex] = {
        ...question,
        reply: requireString(record.message, path, lineNumber, 'message'),
        repliedAt: requireTimestamp(record.at, path, lineNumber, 'at'),
      }
      lifecycle.state = lifecycle.questions.some((item) => item.reply === null)
        ? 'waiting-interaction'
        : 'running'
      return true
    }
    case 'background_cancelled':
      lifecycle.state = 'stopped'
      lifecycle.completedAt = requireTimestamp(record.at, path, lineNumber, 'at')
      return true
    case 'background_done':
      {
        const done = parseBackgroundDone(record, path, lineNumber)
        lifecycle.report = done.summary
        lifecycle.state = 'completed'
        lifecycle.completedAt = done.at
      }
      return true
    default:
      throw sessionFileError(
        path,
        lineNumber,
        `unsupported background lifecycle record ${String(record.type)}`,
      )
  }
}

function applyCompletion(
  lifecycle: MutableBackgroundLifecycle,
  completion: BackgroundCompletion,
): void {
  lifecycle.state = completion.state
  lifecycle.outcome = completion.outcome
  lifecycle.summary = completion.summary
  lifecycle.completedAt = completion.at
}

function replaceRegisteredItem(task: RegisteredBackgroundTask): void {
  task.turn.items[task.itemIndex] = backgroundItem(task)
}

// A record targeting a task whose dispatch turn is already sealed drives a §8.2 turn
// revision; the in-place write above is a no-op on the detached restored turn.
function emitSealedTurnRevision(
  task: RegisteredBackgroundTask,
  update: BackgroundItemRevisionUpdate,
  revision: SealedTurnRevisionSink | undefined,
): void {
  if (revision && task.turn.id !== revision.openTurnId) {
    revision.emit(task.turn.id, task.itemIndex, update)
  }
}

// §8.2 Writer-side resolution: reconstruct the reducer's item model from the sealed
// turn's persisted item (its full progress/questions, which the bounded checkpoint
// status drops) and replay the late update, so the durable row converges identically.
export function applyBackgroundItemRevision(
  turnId: string,
  persistedItem: BackgroundItem,
  update: BackgroundItemRevisionUpdate,
): BackgroundItem {
  const lifecycle = lifecycleFromItem(persistedItem)
  if (update.kind === 'lifecycle') {
    if (!applyLifecycleRecord(
      lifecycle,
      update.record,
      update.path,
      update.lineNumber,
    )) return persistedItem
  } else if (update.kind === 'completion') {
    applyCompletion(lifecycle, update.completion)
  } else {
    lifecycle.state = 'interrupted'
    lifecycle.completedAt = update.at
  }
  // `turnId` reconstructs the item's `${turn.id}:background:${taskId}` id so the
  // revised item stays byte-identical to what the dispatch turn's seal produced.
  const task: RegisteredBackgroundTask = {
    taskId: persistedItem.taskId,
    origin: persistedItem.origin,
    turn: { id: turnId, items: [] },
    itemIndex: 0,
    lifecycle,
    dispatch: dispatchFromItem(persistedItem.taskId, persistedItem),
    indexedCompletion: null,
    terminalSource: null,
  }
  return backgroundItem(task)
}

function backgroundItem(task: RegisteredBackgroundTask): BackgroundItem {
  const lifecycle = task.indexedCompletion === null
    ? task.lifecycle
    : {
        ...task.lifecycle,
        state: task.indexedCompletion.state,
        outcome: task.indexedCompletion.outcome,
        summary: task.indexedCompletion.summary,
        completedAt: task.indexedCompletion.at,
      }
  const dispatchless = {
    id: backgroundItemId(task),
    kind: 'activity' as const,
    activityType: 'background' as const,
    taskId: task.taskId,
    progress: lifecycle.progress,
    questions: lifecycle.questions,
    report: lifecycle.report,
  }
  if (task.origin === 'completion-only') {
    const status = lifecycle.state === 'failed'
      ? 'failed' as const
      : 'completed' as const
    return {
      ...dispatchless,
      text: '后台任务已完成',
      origin: 'completion-only',
      status,
      outcome: lifecycle.outcome ?? '',
      report: null,
      summary: lifecycle.summary ?? '',
      completedAt: lifecycle.completedAt!,
      at: lifecycle.completedAt!,
    }
  }
  const dispatch = task.dispatch!
  const common = { ...dispatchless, at: dispatch.at }
  if (lifecycle.state === 'stopped') {
    return {
      ...common,
      text: dispatch.label ? `子任务已停止：${dispatch.label}` : '子任务已停止',
      origin: 'dispatch-recorded',
      label: dispatch.label,
      prompt: dispatch.prompt,
      source: dispatch.source,
      outcome: null,
      report: null,
      summary: null,
      status: 'stopped',
      completedAt: lifecycle.completedAt!,
    }
  }
  if (lifecycle.state === 'interrupted') {
    return {
      ...common,
      text: dispatch.label ? `子任务已中断：${dispatch.label}` : '子任务已中断',
      origin: 'dispatch-recorded',
      label: dispatch.label,
      prompt: dispatch.prompt,
      source: dispatch.source,
      outcome: null,
      report: null,
      summary: null,
      status: 'interrupted',
      completedAt: lifecycle.completedAt!,
    }
  }
  if (lifecycle.completedAt !== null) {
    if (lifecycle.state === 'failed') {
      return {
        ...common,
        text: dispatch.label ? `子任务已完成：${dispatch.label}` : '子任务已完成',
        origin: 'dispatch-recorded',
        label: dispatch.label,
        prompt: dispatch.prompt,
        source: dispatch.source,
        outcome: lifecycle.outcome!,
        report: lifecycle.report,
        summary: lifecycle.summary,
        status: 'failed',
        completedAt: lifecycle.completedAt,
      }
    }
    return {
      ...common,
      text: dispatch.label ? `子任务已完成：${dispatch.label}` : '子任务已完成',
      origin: 'dispatch-recorded',
      label: dispatch.label,
      prompt: dispatch.prompt,
      source: dispatch.source,
      outcome: lifecycle.outcome,
      report: lifecycle.report,
      summary: lifecycle.summary,
      status: 'completed',
      completedAt: lifecycle.completedAt,
    }
  }
  return {
    ...common,
    text: lifecycle.state === 'waiting-interaction'
      ? dispatch.label
        ? `子任务等待回复：${dispatch.label}`
        : '子任务等待回复'
      : dispatch.label
        ? `已启动子任务：${dispatch.label}`
        : '已启动子任务',
    origin: 'dispatch-recorded',
    label: dispatch.label,
    prompt: dispatch.prompt,
    source: dispatch.source,
    outcome: null,
    report: null,
    summary: null,
    status: lifecycle.state === 'waiting-interaction'
      ? 'waiting-interaction'
      : 'running',
    completedAt: null,
  }
}

function backgroundItemId(task: RegisteredBackgroundTask): string {
  const base = `${task.turn.id}:background:${task.taskId}`
  return task.origin === 'completion-only' && isLegacyShellProcessId(task.taskId)
    ? `${base}:completion:${task.itemIndex}`
    : base
}

function parseBackgroundDone(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): { readonly summary: string; readonly at: string } {
  requireNonEmptyString(record.task_id, path, lineNumber, 'task_id')
  const summary = requireString(record.summary, path, lineNumber, 'summary')
  const at = requireTimestamp(record.at, path, lineNumber, 'at')
  const supportedFields = new Set(['type', 'task_id', 'summary', 'at'])
  const unsupportedFields = Object.keys(record)
    .filter((field) => !supportedFields.has(field))
    .sort()
  if (unsupportedFields.length > 0) {
    throw sessionFileError(
      path,
      lineNumber,
      `background_done contains unsupported fields: ${unsupportedFields.join(', ')}`,
    )
  }
  return { summary, at }
}

function isBackgroundLifecycleRecord(type: unknown): boolean {
  return type === 'background_progress' ||
    type === 'background_question' ||
    type === 'background_replied' ||
    type === 'background_cancelled' ||
    type === 'background_done'
}

function backgroundTerminalSource(
  type: unknown,
): 'done' | 'cancelled' | null {
  if (type === 'background_done') return 'done'
  if (type === 'background_cancelled') return 'cancelled'
  return null
}
