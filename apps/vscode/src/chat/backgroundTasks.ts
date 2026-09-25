import { randomUUID } from "node:crypto"
import type { AppServerBackgroundTerminal, AppServerHost, AppServerHostEvent } from "@codem/app-server"
import type { BackgroundView, BackgroundTaskView } from "../shared/messages.ts"

export interface BackgroundContext {
  host: Pick<AppServerHost, "listBackgroundTerminals" | "terminateBackgroundTerminal" | "cleanBackgroundTerminals" | "cancelBackgroundTask">
  cwd: string
  threadId: string
}
export interface BackgroundSnapshot {
  background: readonly BackgroundView[]
  backgroundTasks: readonly BackgroundTaskView[]
  backgroundBusy: boolean
}

/** Owns background handles, refresh exclusion and polling for the current conversation. */
export class BackgroundTasks {
  private readonly terminals = new Map<string, AppServerBackgroundTerminal>()
  private readonly tasks = new Map<string, { taskId: string; view: BackgroundTaskView }>()
  /** Only a user-initiated terminate, clean or cancel holds the chat's busy gate. */
  private mutating = false
  /** List reads in flight; reads never publish busy and a poll never overlaps one. */
  private reading = 0
  private revision = 0
  /** A newer read or mutation makes older list results stale. */
  private reads = 0
  private poll: ReturnType<typeof setInterval> | null = null

  private readonly changed: (snapshot: BackgroundSnapshot, notice?: string) => void
  private readonly assertTrusted: () => void
  private readonly report: (operation: string, error: unknown) => void

  constructor(changed: (snapshot: BackgroundSnapshot, notice?: string) => void, assertTrusted: () => void, report: (operation: string, error: unknown) => void) {
    this.changed = changed
    this.assertTrusted = assertTrusted
    this.report = report
  }

  snapshot(): BackgroundSnapshot {
    return {
      background: [...this.terminals].map(([id, terminal], index) => ({ id, label: `后台进程 ${index + 1}`, inProgress: terminal.inProgress })),
      backgroundTasks: [...this.tasks.values()].map(task => ({ ...task.view })),
      backgroundBusy: this.mutating,
    }
  }

  clear(): void {
    this.revision++
    this.terminals.clear()
    this.tasks.clear()
    this.mutating = false
    this.reading = 0
  }

  startPolling(context: () => BackgroundContext | null): void {
    this.stopPolling()
    this.poll = setInterval(() => {
      const current = context()
      if (current) void this.read(current, false)
    }, 3000)
    this.poll.unref()
  }

  stopPolling(): void {
    if (this.poll) clearInterval(this.poll)
    this.poll = null
  }

  wake(event: Extract<AppServerHostEvent, { type: "background-wake" }>): void {
    const previous = [...this.tasks].find(([, task]) => task.taskId === event.taskId)
    const id = previous?.[0] ?? randomUUID()
    const label = previous?.[1].view.label ?? `后台任务 ${this.tasks.size + 1}`
    this.tasks.delete(id)
    this.tasks.set(id, { taskId: event.taskId, view: { id, label, phase: event.phase } })
    this.changed(this.snapshot())
  }

  async refresh(context: BackgroundContext): Promise<void> { await this.read(context, true) }
  async terminate(context: BackgroundContext, id: string): Promise<void> {
    const terminal = this.terminals.get(id)
    if (terminal) await this.mutate(context, async () => { await context.host.terminateBackgroundTerminal(context.cwd, context.threadId, terminal.processId) })
  }
  async clean(context: BackgroundContext): Promise<void> {
    await this.mutate(context, async () => { await context.host.cleanBackgroundTerminals(context.cwd, context.threadId) })
  }
  async cancel(context: BackgroundContext, id: string): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) return
    const revision = this.revision
    await this.mutate(context, async () => {
      const phase = await context.host.cancelBackgroundTask(context.cwd, context.threadId, task.taskId)
      if (revision !== this.revision) return
      this.tasks.set(id, { ...task, view: { ...task.view, phase } })
      this.changed(this.snapshot())
    })
  }
  async showLog(id: string, show: (path: string) => Promise<void>): Promise<void> {
    const terminal = this.terminals.get(id)
    if (!terminal) return
    this.assertTrusted()
    await show(terminal.logPath)
  }

  /** A read shares the list with the chat but never its busy gate. A manual refresh always reads (the newest read wins) and reports failure. */
  private async read(context: BackgroundContext, manual: boolean): Promise<void> {
    if (this.mutating || (!manual && this.reading)) return
    const revision = this.revision
    this.reading++
    try {
      this.assertTrusted()
      await this.list(context, revision)
    } catch (error) {
      this.report("background", error)
      if (manual && revision === this.revision) this.changed(this.snapshot(), "后台列表刷新失败，请稍后重试。")
    } finally {
      if (revision === this.revision) this.reading--
    }
  }

  private async mutate(context: BackgroundContext, action: () => Promise<void>): Promise<void> {
    if (this.mutating) return
    const revision = this.revision
    this.mutating = true
    this.reads++
    this.changed(this.snapshot())
    try {
      this.assertTrusted()
      await action()
      if (revision !== this.revision) return
      await this.list(context, revision)
    } catch (error) {
      this.report("background", error)
      if (revision === this.revision) this.changed(this.snapshot(), "后台操作失败，请刷新后重试。")
    } finally {
      if (revision === this.revision) {
        this.mutating = false
        this.changed(this.snapshot())
      }
    }
  }

  /** Publishes only a changed list; a result superseded by a newer read, mutation or conversation is dropped. */
  private async list(context: BackgroundContext, revision: number): Promise<void> {
    const read = ++this.reads
    const result = await context.host.listBackgroundTerminals(context.cwd, context.threadId)
    if (revision !== this.revision || read !== this.reads) return
    const current = [...this.terminals.values()]
    if (current.length === result.terminals.length && result.terminals.every((terminal, index) => terminal.processId === current[index]!.processId && terminal.inProgress === current[index]!.inProgress && terminal.logPath === current[index]!.logPath)) return
    const previous = new Map([...this.terminals].map(([id, terminal]) => [terminal.processId, id]))
    this.terminals.clear()
    for (const terminal of result.terminals) this.terminals.set(previous.get(terminal.processId) ?? randomUUID(), terminal)
    this.changed(this.snapshot())
  }
}
