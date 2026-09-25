import { APP_SERVER_BUILTIN_INTELLIGENCE_TIERS, DEFAULT_APP_SERVER_THREAD_SETTINGS, type AppServerModelSummary, type AppServerSpace, type AppServerThreadSettings } from "@codem/app-server"
import { parseCodemIntelligence, type CodemModeState, type CodemPermissionMode, type CodemWorkMode } from "@codem/protocol"
import type { SettingsPersistence, SettingsScope } from "../connection/connectionPreferences.ts"
import type { ComposerCatalog, LocalComposerSettings } from "../shared/composerSettings.ts"
import type { ChatSnapshot } from "../shared/messages.ts"
import { UserVisibleError } from "../shared/userVisibleError.ts"
import { ComposerCatalogView } from "./composerCatalog.ts"

/** The snapshot fields that project the effective settings. */
export type SettingsView = Pick<ChatSnapshot, "model" | "effort" | "permission" | "workMode" | "mcpNames">
/** The fixed choices this Host owns without a connection; the model and MCP servers come from one. */
export type ChoicesView = Pick<SettingsView, "effort" | "permission" | "workMode">

/** What a connection contributes: its persistence scope, Core's current model, its model catalog and MCP servers. */
export interface SettingsConnection extends SettingsScope {
  readonly model: string
  readonly models: readonly AppServerModelSummary[]
  readonly mcpServers: AppServerThreadSettings["mcpServers"]
}

/** Settings read for a connection that is not bound yet; binding commits them. */
export interface RestoredSettings {
  readonly settings: AppServerThreadSettings
  readonly notice: string | null
}

/** Core writes an existing thread needs for a choice, in Core's mode vocabulary. */
export interface SettingsChange {
  readonly resume: boolean
  readonly modes: { readonly permissionMode: CodemPermissionMode; readonly workMode: CodemWorkMode } | null
}

/** A yes/no question for the Host to show. */
export interface ApprovalQuestion {
  readonly kind: "approval"
  readonly title: string
  readonly description: string
  readonly choices: readonly { readonly value: boolean; readonly label: string }[]
}
/** Shows one question; resolves null when it is dismissed or the signal withdraws it. */
export type ApprovalRequest = (question: ApprovalQuestion, signal: AbortSignal) => Promise<{ readonly values: readonly boolean[] } | null>

export interface ChatSettingsOptions {
  preferences?: SettingsPersistence
  /** Without it, full access is never granted. */
  requestApproval?: ApprovalRequest
  report: (operation: string, error: unknown) => void
}

const fullAccessQuestion: ApprovalQuestion = Object.freeze({
  kind: "approval",
  title: "启用完全访问？",
  description: "任务将跳过工具权限审批执行操作。仅对你信任的任务启用。",
  choices: Object.freeze([Object.freeze({ value: false, label: "保持当前权限" }), Object.freeze({ value: true, label: "启用完全访问" })]),
})

/** Core's work mode as a thread setting. */
function threadWorkMode(mode: CodemWorkMode): LocalComposerSettings["workMode"] { return mode === "plan" ? "plan" : "default" }
/** A thread work mode as Core's. */
function coreWorkMode(mode: LocalComposerSettings["workMode"]): CodemWorkMode { return mode === "plan" ? "plan" : "normal" }

function defaults(): AppServerThreadSettings { return { ...DEFAULT_APP_SERVER_THREAD_SETTINGS, permissionMode: "default" } }

/**
 * The single owner of chat settings: offline choices awaiting a scope, the effective thread settings,
 * the bound connection's catalog handles, their persistence, and the full-access question. The controller
 * admits operations, talks to Core and publishes; every change here returns the view it has to publish.
 */
export class ChatSettings {
  private readonly options: ChatSettingsOptions
  /** Offline choices not yet stored in a connection's scope; mirrored in workspaceState until promoted. */
  private pending: Partial<LocalComposerSettings>
  /** What the next thread/start, resume and editor generation use. Replaced, never edited. */
  private effective: AppServerThreadSettings
  /** The connection these settings belong to; null while offline. */
  private binding: { readonly scope: SettingsScope; readonly models: readonly AppServerModelSummary[] } | null = null
  private readonly catalogView = new ComposerCatalogView()
  /** Withdraws the one open full-access question. */
  private confirmation: AbortController | null = null

  constructor(options: ChatSettingsOptions) {
    this.options = options
    this.pending = options.preferences?.pendingSettings() ?? {}
    this.effective = { ...defaults(), ...this.pending }
  }

  /** The effective settings. Immutable: every change replaces the object. */
  current(): AppServerThreadSettings { return this.effective }
  /** A private copy a picker may edit. */
  draft(): AppServerThreadSettings { return structuredClone(this.effective) }

  choices(): ChoicesView {
    return { effort: parseCodemIntelligence(this.effective.intelligence), permission: this.effective.permissionMode, workMode: this.effective.workMode }
  }

  view(): SettingsView {
    return { model: this.effective.model, ...this.choices(), mcpNames: this.effective.mcpServers.map(server => server.name) }
  }

  /** Model and space choices of the bound connection; empty while offline. */
  catalog(): ComposerCatalog {
    return this.binding ? this.catalogView.snapshot(this.effective.model, this.binding.scope.space.key) : { models: [], spaces: [] }
  }
  catalogModel(id: string): string | undefined { return this.catalogView.model(id) }
  catalogSpace(id: string): string | undefined { return this.catalogView.space(id) }
  /** An explicit refresh replaces every space handle; earlier handles stop resolving. */
  updateSpaces(spaces: readonly AppServerSpace[]): void { this.catalogView.updateSpaces(spaces) }

  /**
   * Reads the scope's saved settings and folds in offline choices. The offline choices are stored in
   * this scope once and then cleared; a failed write keeps them for the next connection.
   * Nothing is bound: an abandoned connection leaves the effective settings as they were.
   */
  async restore(connection: SettingsConnection): Promise<RestoredSettings> {
    const preferences = this.options.preferences
    const saved = await preferences?.load(connection)
    const available = !saved || connection.models.some(model => model.id === saved.model)
    const settings: AppServerThreadSettings = { ...defaults(), ...saved, model: available && saved ? saved.model : connection.model, mcpServers: connection.mcpServers, ...this.pending }
    let notice = available ? null : "已保存的模型当前不可用，暂用 Core 当前模型；原选择仍保留，可重新选择模型。"
    if (Object.keys(this.pending).length) {
      try {
        // Bind the unconnected choice once. Preserve an unavailable saved model preference.
        await preferences?.save(connection, { ...(saved ?? settings), ...this.pending })
        await preferences?.savePendingSettings({})
        this.pending = {}
      } catch (error) {
        this.options.report("saveSettings", error)
        notice = [notice, "设置已应用，但保存失败；下次连接会继续尝试保存。"].filter(Boolean).join(" ")
      }
    }
    return { settings, notice }
  }

  /** Commits restored settings for the now-current connection and issues its catalog handles. */
  bind(connection: SettingsConnection, restored: RestoredSettings, spaces: readonly AppServerSpace[]): SettingsView {
    this.binding = { scope: { cwd: connection.cwd, space: { key: connection.space.key } }, models: connection.models }
    this.catalogView.bind(connection.models, spaces)
    this.effective = restored.settings
    return this.view()
  }

  /** The connection retired: its scope, handles and any open question go. The effective settings stay until the next binding replaces them. */
  unbind(): void {
    this.binding = null
    this.catalogView.bind([], [])
    this.cancelConfirmation()
  }

  /** Account reset: back to defaults plus offline choices, bound to nothing. */
  reset(): SettingsView {
    this.unbind()
    this.effective = { ...defaults(), ...this.pending }
    return this.view()
  }

  /** Core's mode state for the current thread wins over any local choice. */
  acceptModes(modes: Pick<CodemModeState, "permissionMode" | "workMode">): SettingsView {
    this.effective = { ...this.effective, permissionMode: modes.permissionMode, workMode: threadWorkMode(modes.workMode) }
    return this.view()
  }

  unchanged(patch: Partial<LocalComposerSettings>): boolean {
    return Object.entries(patch).every(([key, value]) => this.effective[key as keyof LocalComposerSettings] === value)
  }

  /** Only switching into full access needs the user's consent. */
  needsConfirmation(patch: Partial<LocalComposerSettings>): boolean {
    return patch.permissionMode === "yolo" && this.effective.permissionMode !== "yolo"
  }

  /**
   * Asks the Host whether to enable full access; never connects Core. True only for explicit consent to a
   * question nobody withdrew: `lifetime` (exit, account reset), `cancelConfirmation`, a newer question or a
   * retired connection withdraws it. It changes no setting; the caller applies the choice after consent.
   */
  async confirmFullAccess(lifetime: AbortSignal): Promise<boolean> {
    const request = this.options.requestApproval
    if (!request || lifetime.aborted) return false
    this.cancelConfirmation()
    const confirmation = new AbortController()
    this.confirmation = confirmation
    const withdraw = () => confirmation.abort()
    lifetime.addEventListener("abort", withdraw, { once: true })
    try {
      const answer = await request(fullAccessQuestion, confirmation.signal)
      return !confirmation.signal.aborted && answer?.values[0] === true
    } finally {
      lifetime.removeEventListener("abort", withdraw)
      if (this.confirmation === confirmation) this.confirmation = null
    }
  }

  /** Withdraws the open full-access question, if any; it then resolves as declined. */
  cancelConfirmation(): void { this.confirmation?.abort() }

  /** An offline choice applies locally at once and stays pending until a connection's scope stores it. */
  chooseOffline(patch: Partial<LocalComposerSettings>): ChoicesView {
    this.pending = { ...this.pending, ...patch }
    this.effective = { ...this.effective, ...patch }
    return this.choices()
  }

  /** Mirrors the pending choices in workspaceState. Returns a notice when the write fails; the choice stays in effect. */
  async savePending(): Promise<string | null> {
    try {
      await this.options.preferences?.savePendingSettings(this.pending)
      return null
    } catch (error) {
      this.options.report("saveSettings", error)
      return "设置已选择，但保存失败；重载后可能无法恢复，请重新选择后重试。"
    }
  }

  /**
   * Rejects a choice outside the bound connection's catalog, and says which Core writes an existing thread
   * needs: a resume for model, effort, roots or MCP servers; a revision-checked mode write when `modes`
   * (read before the picker opened) differs from the choice.
   */
  review(next: AppServerThreadSettings, modes: CodemModeState | null): SettingsChange {
    if (!this.binding?.models.some(model => model.id === next.model) || !APP_SERVER_BUILTIN_INTELLIGENCE_TIERS.some(effort => effort === next.intelligence)) throw new UserVisibleError("模型或思考强度不在 Core 支持的列表中。")
    const current = this.effective
    const resume = next.model !== current.model || next.intelligence !== current.intelligence || JSON.stringify(next.additionalDirectories) !== JSON.stringify(current.additionalDirectories) || JSON.stringify(next.mcpServers) !== JSON.stringify(current.mcpServers)
    const workMode = coreWorkMode(next.workMode)
    return { resume, modes: modes && (modes.permissionMode !== next.permissionMode || modes.workMode !== workMode) ? { permissionMode: next.permissionMode, workMode } : null }
  }

  /** Core resumed the thread with the choice's model, effort, roots and MCP servers; modes are confirmed separately. */
  acceptResumed(next: AppServerThreadSettings): SettingsView {
    this.effective = { ...this.effective, model: next.model, intelligence: next.intelligence, additionalDirectories: next.additionalDirectories, mcpServers: next.mcpServers }
    return this.view()
  }

  /** The whole choice applied. With a thread, the modes Core confirmed win over the requested ones. */
  commit(next: AppServerThreadSettings, confirmed: CodemModeState | null): SettingsView {
    this.effective = confirmed ? { ...next, permissionMode: confirmed.permissionMode, workMode: threadWorkMode(confirmed.workMode) } : next
    return this.view()
  }

  /**
   * Stores the applied settings in the bound scope, promoting and then clearing any offline choice that is
   * still pending. Returns a notice when a write fails; pending choices then stay for the next attempt.
   */
  async persist(): Promise<string | null> {
    const binding = this.binding
    if (!binding) return null
    const preferences = this.options.preferences
    try {
      // A failed earlier promotion must never overwrite a newer connected choice.
      if (Object.keys(this.pending).length) {
        this.pending = Object.fromEntries(Object.keys(this.pending).map(key => [key, this.effective[key as keyof LocalComposerSettings]]))
        await preferences?.savePendingSettings(this.pending)
      }
      await preferences?.save(binding.scope, this.effective)
      if (Object.keys(this.pending).length) {
        await preferences?.savePendingSettings({})
        this.pending = {}
      }
      return null
    } catch (error) {
      this.options.report("saveSettings", error)
      return "配置已应用，但保存失败；重载后可能无法恢复，请重新选择后重试。"
    }
  }
}
