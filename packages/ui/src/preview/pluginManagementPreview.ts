import type { ChatSnapshot } from "../contract.ts"

/** UI fixture: installation changes a local in-memory registry, never the real Core registry. */
export function pluginManagementPreview(publish: (snapshot: ChatSnapshot) => void, initial: ChatSnapshot) {
  let state: ChatSnapshot = { ...initial, pluginManagement: { open: false, loaded: false, status: "idle", entries: [], skills: [], error: null, notice: null } }
  let revision = 0
  publish(state)
  return (action: Record<string, unknown>) => {
    const view = state.pluginManagement!
    if (action.type === "closePluginManagement") { state = { ...state, pluginManagement: { ...view, open: false } }; publish(state); return }
    if (action.type === "cancelPluginOperation") { revision++; state = { ...state, phase: "ready", pluginManagement: { ...view, status: "error", error: "操作已取消，清单已核对。" } }; publish(state); return }
    if (!["showPluginManagement", "installMarketplacePlugin", "installLocalPlugin", "changePlugin"].includes(String(action.type))) return
    const current = ++revision
    state = { ...state, phase: "configuring", pluginManagement: { ...view, open: true, status: action.type === "showPluginManagement" ? "loading" : "mutating", error: null, notice: null } }; publish(state)
    window.setTimeout(() => {
      if (current !== revision) return
      const previous = state.pluginManagement!
      let entries = previous.entries
      if (action.type === "installMarketplacePlugin" && action.spec !== "missing@fixture" || action.type === "installLocalPlugin") entries = [{ id: "fixture-plugin", name: "sample", enabled: true, version: "1.0.0" }]
      if (action.type === "changePlugin") entries = action.action === "uninstall" ? [] : entries.map(entry => ({ ...entry, enabled: action.action === "enable" }))
      const failed = action.spec === "missing@fixture"
      state = { ...state, phase: "ready", pluginManagement: { ...previous, status: failed ? "error" : "ready", loaded: true, entries, error: failed ? "插件来源不存在，请检查后重试。" : null, notice: null } }; publish(state)
    }, 400)
  }
}
