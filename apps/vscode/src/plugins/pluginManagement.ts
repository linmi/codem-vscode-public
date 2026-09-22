import { PluginOperationError } from "@codem/app-server"
import { randomUUID } from "node:crypto"
import type { InstalledPlugin, PluginCommands, PluginSource, PluginChange } from "@codem/app-server"
import type { PluginManagementView } from "@codem/protocol"

export interface PluginManagementContext {
  commands: PluginCommands
  authorize: () => Promise<void>
  assertCurrent: () => void
  skills: () => Promise<readonly { name: string; description: string }[]>
  acceptSkills: (skills: readonly { name: string; description: string }[]) => void
}
export class PluginManagement {
  private view: PluginManagementView = this.empty()
  private entries = new Map<string, InstalledPlugin>()
  private operation: { command: AbortController; scope: AbortController; settled: Promise<void> } | null = null
  private readonly publish: () => void
  private readonly report: (operation: string, error: unknown) => void
  constructor(publish: () => void, report: (operation: string, error: unknown) => void) { this.publish = publish; this.report = report }
  private empty(): PluginManagementView { return { open: false, loaded: false, status: "idle", entries: [], skills: [], error: null, notice: null } }
  snapshot(): PluginManagementView { return this.view }
  get busy(): boolean { return this.operation !== null }
  close(): void { this.view = { ...this.view, open: false }; this.publish() }
  cancel(): void { this.operation?.command.abort() }
  reset(): Promise<void> {
    const pending = this.operation
    pending?.scope.abort(); pending?.command.abort()
    this.view = this.empty(); this.entries.clear()
    return pending?.settled ?? Promise.resolve()
  }
  refresh(context: PluginManagementContext): Promise<void> { return this.run(context, null) }
  install(context: PluginManagementContext, pick: (signal: AbortSignal) => Promise<PluginSource | null>): Promise<void> { return this.run(context, { kind: "install", pick }) }
  change(context: PluginManagementContext, action: PluginChange, id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry) { this.view = { ...this.view, error: "插件清单已变化，请刷新后重试。" }; this.publish(); return Promise.resolve() }
    return this.run(context, { kind: "change", action, entry })
  }
  private run(context: PluginManagementContext, mutation: { kind: "install"; pick: (signal: AbortSignal) => Promise<PluginSource | null> } | { kind: "change"; action: PluginChange; entry: InstalledPlugin } | null): Promise<void> {
    if (this.operation) return Promise.resolve()
    const operation = { command: new AbortController(), scope: new AbortController(), settled: Promise.resolve() }
    this.operation = operation
    this.view = { ...this.view, open: true, status: mutation ? "mutating" : "loading", error: null, notice: null }
    this.publish()
    const current = () => { operation.scope.signal.throwIfAborted(); context.assertCurrent() }
    const commandSignal = AbortSignal.any([operation.scope.signal, operation.command.signal])
    operation.settled = (async () => {
      let applied = false, attempted = false, failure: unknown = null, installedName: string | null = null
      try {
        current(); await context.authorize(); current(); commandSignal.throwIfAborted()
        if (mutation?.kind === "install") {
          const source = await chooseSource(mutation.pick, commandSignal)
          current(); commandSignal.throwIfAborted()
          if (!source) { this.view = { ...this.view, status: this.view.loaded ? "ready" : "idle", notice: "已取消选择插件。" }; return }
          context.acceptSkills([]); this.view = { ...this.view, skills: [] }
          attempted = true
          installedName = await context.commands.install(source, commandSignal); applied = true
        } else if (mutation?.kind === "change") {
          context.acceptSkills([]); this.view = { ...this.view, skills: [] }
          attempted = true
          await context.commands.change(mutation.action, mutation.entry, commandSignal); applied = true
        }
      } catch (error) { failure = error }
      if (operation.scope.signal.aborted) return
      // A killed write may already have changed the registry. Read back once; never retry writes.
      if (mutation && attempted) { this.view = { ...this.view, status: "reconciling" }; this.publish() }
      try {
        current()
        if (failure && !attempted) throw failure
        const signal = attempted ? operation.scope.signal : commandSignal
        const entries = await context.commands.list(signal)
        current(); signal.throwIfAborted()
        this.entries.clear()
        this.view = { ...this.view, loaded: true, entries: entries.map(entry => { const id = randomUUID(); this.entries.set(id, entry); return { id, name: entry.name, version: entry.version, enabled: entry.enabled } }) }
        if (applied && mutation) {
          const verified = mutation.kind === "install" ? entries.some(entry => entry.name === installedName && entry.enabled) : mutation.action === "uninstall" ? !entries.some(entry => entry.key === mutation.entry.key) : entries.some(entry => entry.key === mutation.entry.key && entry.enabled === (mutation.action === "enable"))
          if (!verified) throw new Error("Core plugin command completed but registry does not match the requested state")
        }
        const skills = await context.skills()
        current(); signal.throwIfAborted()
        context.acceptSkills(skills)
        this.view = { ...this.view, skills, status: failure ? "error" : "ready", error: failure ? failureMessage(failure) : null, notice: applied ? "插件清单已更新，当前连接的技能目录已刷新。未出现在技能目录中的能力暂不可用。" : null }
        if (failure) this.report("pluginManagement", failure)
      } catch (error) {
        if (operation.scope.signal.aborted) return
        this.report("pluginManagement", error)
        this.view = { ...this.view, status: "error", skills: [], error: applied ? "插件操作已完成，但刷新或核验失败。请刷新清单，勿重复安装。" : operation.command.signal.aborted ? "操作已取消，请刷新清单确认当前状态。" : "插件操作失败，请检查来源或刷新清单后重试。" }
      }
    })().finally(() => {
      if (this.operation === operation) { this.operation = null; if (!operation.scope.signal.aborted) this.publish() }
    })
    return operation.settled
  }
}

// Native folder pickers cannot be dismissed through VS Code's API. Release the
// connection immediately on cancellation and ignore any later picker result.
function chooseSource(pick: (signal: AbortSignal) => Promise<PluginSource | null>, signal: AbortSignal): Promise<PluginSource | null> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason) }
    signal.addEventListener("abort", abort, { once: true })
    Promise.resolve().then(() => { signal.throwIfAborted(); return pick(signal) }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

function failureMessage(error: unknown): string {
  if (error instanceof PluginOperationError) return {
    alreadyInstalled: "插件已安装，未覆盖现有版本。请检查清单。",
    stale: "插件状态已被其他操作改变，请按刷新后的清单重试。",
    cancelled: "操作已取消，已重新核对清单；取消前可能已完成写入，请检查当前状态。",
    timeout: "操作超时，已重新核对清单；请检查当前状态后重试。",
    commandFailed: "Core 拒绝了操作，已重新核对清单；请检查插件目录或已配置的市场标识。",
  }[error.code]
  return "操作未确认，已重新核对清单；请检查当前状态后重试。"
}
