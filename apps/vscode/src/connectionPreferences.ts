import { createHash } from "node:crypto"
import { APP_SERVER_BUILTIN_INTELLIGENCE_TIERS, type AppServerThreadSettings } from "@codem/app-server"

export type SavedSettings = Pick<AppServerThreadSettings, "model" | "intelligence" | "permissionMode" | "workMode">
export interface ConnectionTarget { cwd: string; workspace: string; key: string }
interface Store { get<T>(key: string): T | undefined; update(key: string, value: unknown): PromiseLike<void> }
export interface SettingsScope { cwd: string; space: { key: string } }
export interface SettingsPersistence {
  load(scope: SettingsScope): Promise<SavedSettings | null>
  save(scope: SettingsScope, settings: SavedSettings): Promise<void>
}

/** Workspace-local preferences only; MCP credentials retain their SecretStorage authority. */
export class ConnectionPreferences implements SettingsPersistence {
  private readonly store: Store
  constructor(store: Store) { this.store = store }
  private key(scope: SettingsScope): string {
    return `codem.settings.${createHash("sha256").update(JSON.stringify([scope.cwd, scope.space.key])).digest("hex")}`
  }
  async load(scope: SettingsScope): Promise<SavedSettings | null> {
    const value = this.store.get<unknown>(this.key(scope))
    return value === undefined ? null : parseSavedSettings(value)
  }
  async save(scope: SettingsScope, settings: SavedSettings): Promise<void> {
    const { model, intelligence, permissionMode, workMode } = settings
    await this.store.update(this.key(scope), parseSavedSettings({ model, intelligence, permissionMode, workMode }))
  }
  lastConnection(): ConnectionTarget | undefined {
    const value = this.store.get<ConnectionTarget>("codem.lastConnection")
    if (value === undefined) return undefined
    if (!value || typeof value.cwd !== "string" || !value.cwd || typeof value.workspace !== "string" || typeof value.key !== "string" || !value.key) throw new Error("Invalid saved CodeM connection")
    return value
  }
  async remember(target: ConnectionTarget): Promise<void> { await this.store.update("codem.lastConnection", target) }
}

export function parseSavedSettings(value: unknown): SavedSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved CodeM settings")
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 4 || typeof record.model !== "string" || !record.model || !APP_SERVER_BUILTIN_INTELLIGENCE_TIERS.some(tier => tier === record.intelligence) || typeof record.permissionMode !== "string" || typeof record.workMode !== "string" || !["default", "auto", "yolo"].includes(String(record.permissionMode)) || !["default", "plan"].includes(String(record.workMode))) throw new Error("Invalid saved CodeM settings")
  return { model: record.model, intelligence: record.intelligence as string, permissionMode: record.permissionMode as SavedSettings["permissionMode"], workMode: record.workMode as SavedSettings["workMode"] }
}
