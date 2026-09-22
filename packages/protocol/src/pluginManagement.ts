export interface PluginManagementView {
  open: boolean
  loaded: boolean
  status: "idle" | "loading" | "mutating" | "reconciling" | "ready" | "error"
  entries: readonly { id: string; name: string; version: string | null; enabled: boolean }[]
  skills: readonly { name: string; description: string }[]
  error: string | null
  notice: string | null
}
