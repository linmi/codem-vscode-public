import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type * as vscode from "vscode"
import type { KiloConnectionService } from "../services/cli-backend"

export interface RemoveConfigItemContext {
  connection: KiloConnectionService
  project: () => string | undefined
  directory: () => string
  refresh: () => Promise<void>
  storage?: vscode.Uri
}

export async function removeMcp(ctx: RemoveConfigItemContext, name: string): Promise<boolean> {
  const project = ctx.project()
  const directory = ctx.directory()
  const projectRemoved = project ? await removeFromKiloJson(name, "project", project) : false
  const globalRemoved = await removeFromKiloJson(name, "global")
  const legacyRemoved = await removeLegacyMcp(name, project, ctx.storage?.fsPath)
  if (!projectRemoved && !globalRemoved && !legacyRemoved) return false

  const scope = globalRemoved ? "global" : "project"
  const target = globalRemoved ? directory : (project ?? directory)
  await invalidate(ctx.connection, scope, target)
  await ctx.refresh()
  return true
}

function globalConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(xdg, "kilo")
}

function kiloJsonPath(scope: "project" | "global", workspace?: string): string {
  if (scope === "project") return path.join(workspace!, ".kilo", "kilo.json")
  return path.join(globalConfigDir(), "kilo.json")
}

async function removeFromKiloJson(name: string, scope: "project" | "global", workspace?: string): Promise<boolean> {
  if (scope === "project" && !workspace) return false
  const filepath = kiloJsonPath(scope, workspace)
  let config: { mcp?: Record<string, unknown> }
  try {
    config = JSON.parse(await fs.readFile(filepath, "utf-8")) as { mcp?: Record<string, unknown> }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
  if (!config.mcp?.[name]) return false
  delete config.mcp[name]
  if (Object.keys(config.mcp).length === 0) delete config.mcp
  await fs.writeFile(filepath, JSON.stringify(config, null, 2) + "\n", "utf-8")
  return true
}

async function removeLegacyMcp(name: string, project: string | undefined, storage?: string): Promise<boolean> {
  const files: string[] = []
  if (project) {
    files.push(path.join(project, ".kilo", "mcp.json"))
    files.push(path.join(project, ".kilocode", "mcp.json"))
  }
  if (storage) files.push(path.join(storage, "settings", "mcp_settings.json"))

  let removed = false
  for (const filepath of files) {
    let parsed: { mcpServers?: Record<string, unknown> }
    try {
      parsed = JSON.parse(await fs.readFile(filepath, "utf-8")) as { mcpServers?: Record<string, unknown> }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue
      console.warn("[CodeM] Failed to read legacy MCP config", filepath, err)
      continue
    }
    if (!parsed.mcpServers?.[name]) continue
    delete parsed.mcpServers[name]
    await fs.writeFile(filepath, JSON.stringify(parsed, null, 2) + "\n", "utf-8")
    removed = true
  }
  return removed
}

async function invalidate(connection: KiloConnectionService, scope: "project" | "global", dir: string): Promise<void> {
  const client = await connection.getClientAsync(dir).catch((err: unknown) => {
    console.warn("[CodeM] CLI invalidation deferred after MCP removal:", err)
    return null
  })
  if (!client) return

  if (scope === "global") {
    await client.global.config.update({ config: {} }).catch((err: unknown) => {
      console.warn("[CodeM] global.config.update after MCP removal failed:", err)
    })
  }
  await client.instance.dispose({ directory: dir }).catch((err: unknown) => {
    console.warn("[CodeM] instance.dispose() after MCP removal failed:", err)
  })
}
