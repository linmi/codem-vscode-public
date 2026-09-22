import type { PluginCommands } from "@codem/app-server"
export function fixturePluginCommands(): PluginCommands {
  return { list: async () => [], install: async () => { throw new Error("Plugin install not configured for fixture") }, change: async () => { throw new Error("Plugin change not configured for fixture") } }
}
