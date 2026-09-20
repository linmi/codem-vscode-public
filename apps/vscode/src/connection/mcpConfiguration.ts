import { isAbsolute } from "node:path"
import type { AppServerMcpServer } from "@codem/app-server"

export interface McpConfiguration { servers: AppServerMcpServer[]; enabled: string[] }
export function parseMcpConfiguration(value: unknown): McpConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved MCP configuration")
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => key !== "servers" && key !== "enabled") || !Array.isArray(record.servers) || !Array.isArray(record.enabled)) throw new Error("Invalid saved MCP configuration")
  const names = new Set<string>()
  const servers = record.servers.map((value: unknown): AppServerMcpServer => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid MCP server")
    const server = value as Record<string, unknown>
    if (Object.keys(server).some((key) => !["type", "name", "command", "args", "env"].includes(key)) || server.type !== "stdio" || typeof server.name !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(server.name) || names.has(server.name) || typeof server.command !== "string" || !isAbsolute(server.command) || !Array.isArray(server.args) || !server.args.every((arg) => typeof arg === "string") || !Array.isArray(server.env)) throw new Error("Invalid MCP stdio server")
    names.add(server.name)
    const envNames = new Set<string>()
    const env = server.env.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid MCP environment")
      const pair = entry as Record<string, unknown>
      if (Object.keys(pair).length !== 2 || typeof pair.name !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pair.name) || envNames.has(pair.name) || typeof pair.value !== "string" || pair.value.includes("\0")) throw new Error("Invalid MCP environment")
      envNames.add(pair.name)
      return { name: pair.name, value: pair.value }
    })
    return { type: "stdio", name: server.name, command: server.command, args: server.args as string[], env }
  })
  const enabled: string[] = []
  for (const name of record.enabled) {
    if (typeof name !== "string" || !names.has(name) || enabled.includes(name)) throw new Error("Unknown or duplicate enabled MCP server")
    enabled.push(name)
  }
  return { servers, enabled }
}
