import { spawn } from "node:child_process"
import { open, realpath } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import {
  PLUGIN_COMMAND_DEADLINE_MS,
  PLUGIN_COMMAND_TERMINATION,
  requirePositiveTimeout,
  terminateChildProcess,
  terminationSpawnOptions,
} from "../processLifecycle.ts"
import type { AppServerRuntime } from "../runtime.ts"

export interface InstalledPlugin {
  readonly key: string
  readonly name: string
  readonly version: string | null
  readonly enabled: boolean
  /** Host-only; never part of the UI snapshot. */
  readonly path: string
}
export type PluginSource = { kind: "local"; path: string } | { kind: "marketplace"; spec: string }
export type PluginChange = "enable" | "disable" | "uninstall"
export class PluginOperationError extends Error {
  readonly code: "alreadyInstalled" | "stale" | "cancelled" | "timeout" | "commandFailed"
  constructor(code: PluginOperationError["code"], message: string) { super(message); this.code = code }
}
export interface PluginCommands {
  list(signal: AbortSignal): Promise<readonly InstalledPlugin[]>
  install(source: PluginSource, signal: AbortSignal): Promise<string>
  change(action: PluginChange, expected: InstalledPlugin, signal: AbortSignal): Promise<void>
}
export interface PluginCommandOptions {
  runtime: AppServerRuntime
  cwd: string
  environment?: NodeJS.ProcessEnv
  timeoutMs?: number
  observe?: (operation: string, elapsedMs: number) => void
}
const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:@[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$/u
export function parseInstalledPlugins(value: unknown): InstalledPlugin[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Core plugin registry")
  if (Object.keys(value).length > 1000) throw new Error("Core plugin registry exceeds 1000 entries")
  return Object.entries(value).map(([key, value]) => {
    const row = value as Record<string, unknown> | null
    if (!keyPattern.test(key) || !row || typeof row !== "object" || Array.isArray(row) || typeof row.name !== "string" || !namePattern.test(row.name) || typeof row.enabled !== "boolean" || typeof row.path !== "string" || !isAbsolute(row.path) || row.version !== undefined && row.version !== null && (typeof row.version !== "string" || !/^[A-Za-z0-9.+_-]{1,100}$/u.test(row.version))) throw new Error("Invalid Core plugin entry")
    return { key, name: row.name, enabled: row.enabled, path: row.path, version: typeof row.version === "string" ? row.version : null }
  })
}

/** Management commands are bounded subprocesses; agent traffic remains on App Server stdio. */
export function createPluginCommands(options: PluginCommandOptions): PluginCommands {
  if (!isAbsolute(options.cwd)) throw new Error("Plugin management requires an absolute workspace")
  requirePositiveTimeout(options.timeoutMs, "plugin command")
  const run = (args: string[], signal: AbortSignal) => runPluginCommand(options, args, signal)
  const list = async (signal: AbortSignal) => parseInstalledPlugins(JSON.parse(await run(["list", "--json"], signal)))
  return {
    list,
    async install(source, signal) {
      signal.throwIfAborted()
      let spec: string, name: string
      if (source.kind === "local") {
        if (!isAbsolute(source.path)) throw new Error("Local plugin source must be a Host-selected absolute directory")
        spec = await realpath(source.path)
        const file = await open(join(spec, ".codem-plugin", "plugin.json"), "r")
        let manifestText: string
        try {
          if (!(await file.stat()).isFile()) throw new Error("Plugin manifest must be a file")
          const buffer = Buffer.alloc(64_001)
          let length = 0
          while (length < buffer.length) {
            signal.throwIfAborted()
            const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
            if (!bytesRead) break
            length += bytesRead
          }
          if (length > 64_000) throw new Error("Plugin manifest exceeds 64 KB")
          manifestText = buffer.toString("utf8", 0, length)
        } finally { await file.close() }
        const manifest = JSON.parse(manifestText) as { name?: unknown }
        if (typeof manifest.name !== "string" || !namePattern.test(manifest.name)) throw new Error("Invalid local plugin name")
        name = manifest.name
        await run(["validate", spec], signal)
      } else {
        if (!keyPattern.test(source.spec) || !source.spec.includes("@")) throw new Error("Use plugin-name@marketplace-name")
        spec = source.spec; name = spec.split("@")[0]!
      }
      const installed = await list(signal)
      if (installed.some(entry => entry.name === name || entry.key === spec)) throw new PluginOperationError("alreadyInstalled", "Plugin already installed; refresh its state instead of overwriting it")
      await run(["install", spec], signal)
      return name
    },
    async change(action, expected, signal) {
      if (!["enable", "disable", "uninstall"].includes(action) || !keyPattern.test(expected.key)) throw new Error("Invalid plugin operation")
      const current = (await list(signal)).find(entry => entry.key === expected.key)
      if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw new PluginOperationError("stale", "Plugin registry changed; refresh before trying again")
      await run([action, current.key], signal)
    },
  }
}

async function runPluginCommand(options: PluginCommandOptions, args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  const started = performance.now()
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(options.runtime.executablePath, ["plugin", ...args], { cwd: options.cwd, env: options.environment ?? process.env, shell: false, ...terminationSpawnOptions(PLUGIN_COMMAND_TERMINATION), stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
      const closed = new Promise<void>(resolve => child.once("close", () => resolve()))
      let stdout = "", bytes = 0, failure: Error | null = null
      const stop = (error: Error) => {
        if (failure) return
        failure = error
        // The command settles only on "close", so a tree that outlives SIGKILL keeps it pending rather than leaking.
        void terminateChildProcess(child, closed, PLUGIN_COMMAND_TERMINATION).catch(() => undefined)
      }
      const abort = () => stop(new PluginOperationError("cancelled", "Plugin operation cancelled; verify the registry before retrying"))
      const timeout = setTimeout(() => stop(new PluginOperationError("timeout", "Plugin operation timed out; verify the registry before retrying")), options.timeoutMs ?? PLUGIN_COMMAND_DEADLINE_MS)
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => { bytes += Buffer.byteLength(chunk); if (bytes > 1024 * 1024) stop(new Error("Core plugin output exceeded 1 MB")); else stdout += chunk })
      // Drain stderr without forwarding paths, credentials, or third-party terminal escapes.
      child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) stop(new Error("Core plugin output exceeded 1 MB")) })
      child.on("error", error => { failure = new Error(`Cannot start Core plugin ${args[0]}`, { cause: error }) })
      child.on("close", (code, exitSignal) => {
        clearTimeout(timeout); signal.removeEventListener("abort", abort)
        if (failure) reject(failure)
        else if (code !== 0 || exitSignal) reject(new PluginOperationError("commandFailed", `Core plugin ${args[0]} failed (exit ${code ?? exitSignal}); check the source and refresh before retrying`))
        else resolve(stdout)
      })
    })
  } finally { options.observe?.(`plugin/${args[0]}`, Math.round(performance.now() - started)) }
}
