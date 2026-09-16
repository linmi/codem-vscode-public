import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { isAbsolute } from "node:path"
import { AppServerRpcPeer, type JsonObject } from "./rpc.ts"
import type { AppServerRuntime } from "./runtime.ts"

export interface AppServerSpace {
  readonly projectKey: string
  readonly displayName: string
}

export interface AppServerSpaceList {
  readonly current: string | null
  readonly spaces: readonly AppServerSpace[]
}

/** Host-only launch material. Never send managedDirectory to a webview. */
export interface AppServerPreparedSpace extends AppServerSpace {
  readonly managedDirectory: string | null
}

export interface AppServerSpaceOptions {
  readonly runtime: AppServerRuntime
  readonly workingDirectory: string
  readonly environment?: NodeJS.ProcessEnv
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export async function listAppServerSpaces(options: AppServerSpaceOptions): Promise<AppServerSpaceList> {
  return parseAppServerSpaces(await callSpaceBroker(options, "project_list", {}))
}

export async function prepareAppServerSpace(
  options: AppServerSpaceOptions,
  projectKey: string,
): Promise<AppServerPreparedSpace> {
  const payload = await callSpaceBroker(options, "space_prepare", { project_key: spaceKey(projectKey) })
  if (payload.project_key !== projectKey || !["ok", "empty"].includes(String(payload.status)))
    throw new Error("CodeM space_prepare returned an invalid space or status")
  const directory = payload.managed_dir
  if (directory !== null && (typeof directory !== "string" || !isAbsolute(directory) || directory.includes("\0")))
    throw new Error("CodeM space_prepare returned an invalid managed directory")
  return {
    projectKey,
    displayName: textValue(payload.project_name, "space name"),
    managedDirectory: directory as string | null,
  }
}

/** Call only after the prepared Core connection has passed preflight. */
export async function commitAppServerSpace(options: AppServerSpaceOptions, projectKey: string): Promise<void> {
  await callSpaceBroker(options, "space_commit", { project_key: spaceKey(projectKey) })
}

export function parseAppServerSpaces(payload: JsonObject): AppServerSpaceList {
  if (!Array.isArray(payload.projects)) throw new Error("Invalid CodeM space list")
  const spaces = payload.projects.map((entry: unknown): AppServerSpace => {
    const project = object(entry)
    return { projectKey: spaceKey(project.project_key), displayName: textValue(project.display_name, "space name") }
  })
  const keys = new Set(spaces.map((space) => space.projectKey))
  if (keys.size !== spaces.length) throw new Error("CodeM space list contains duplicate spaces")
  const current = payload.current === null ? null : spaceKey(payload.current)
  if (current !== null && !keys.has(current)) throw new Error("CodeM current space is absent from its space list")
  return { current, spaces }
}

export function appServerSpaceLaunch(space: AppServerPreparedSpace): {
  readonly arguments: readonly string[]
  readonly environment: NodeJS.ProcessEnv
} {
  const key = spaceKey(space.projectKey)
  if (space.managedDirectory !== null && !isAbsolute(space.managedDirectory))
    throw new Error("Invalid CodeM managed directory")
  return {
    arguments: ["--project-key", key],
    // Empty is Core's explicit 'no managed layer', not inherited ambient config.
    environment: { CODEM_MANAGED_DIR: space.managedDirectory ?? "" },
  }
}

async function callSpaceBroker(
  options: AppServerSpaceOptions,
  name: "project_list" | "space_prepare" | "space_commit",
  args: JsonObject,
): Promise<JsonObject> {
  if (!isAbsolute(options.workingDirectory)) throw new Error("CodeM space workingDirectory must be absolute")
  const timeout = options.timeoutMs ?? 180_000
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("Invalid CodeM space timeout")
  options.signal?.throwIfAborted()
  const child = spawn(options.runtime.authExecutablePath, ["__host-serve"], {
    cwd: options.workingDirectory,
    env: options.environment ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  // Broker payloads and stderr may include credentials. Never forward either.
  child.stderr.resume()
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()))
  let failure: Error | null = null
  const fail = (message: string): void => {
    failure ??= new Error(message)
    child.kill("SIGKILL")
  }
  child.once("error", () => fail(`Could not start CodeM ${name} broker`))
  let bytes = 0
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > 1024 * 1024) fail(`CodeM ${name} response exceeded its size limit`)
  })
  const peer = new AppServerRpcPeer({
    stdin: child.stdin,
    stdoutLines: createInterface({ input: child.stdout, crlfDelay: Infinity }),
    onNotification: () => fail(`CodeM ${name} broker sent an unexpected notification`),
    onRequest: () => fail(`CodeM ${name} broker sent an unexpected request`),
    onProtocolError: () => fail(`CodeM ${name} broker protocol failed`),
  })
  const timer = setTimeout(() => fail(`CodeM ${name} timed out`), timeout)
  const abort = (): void => fail(`CodeM ${name} cancelled`)
  options.signal?.addEventListener("abort", abort, { once: true })
  if (options.signal?.aborted) abort()
  try {
    const initialized = object(await peer.request("initialize", {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "codem-editor-spaces", version: "1" },
    }))
    const server = object(initialized.serverInfo)
    if (initialized.protocolVersion !== "2025-03-26" || server.name !== "codem__host" || server.version !== options.runtime.cliVersion)
      throw new Error("CodeM space broker version/protocol mismatch; reinstall the pinned runtime")
    peer.notify("notifications/initialized", {})
    const result = object(await peer.request("tools/call", { name, arguments: args }))
    if (result.isError === true || !Array.isArray(result.content) || result.content.length !== 1)
      throw new Error(`CodeM ${name} broker rejected the request; refresh your login and retry`)
    const content = object(result.content[0])
    if (content.type !== "text" || typeof content.text !== "string") throw new Error(`Invalid CodeM ${name} response`)
    let payload: JsonObject
    try { payload = object(JSON.parse(content.text)) } catch { throw new Error(`Invalid CodeM ${name} payload`) }
    if (payload.ok !== true) throw new Error(`CodeM ${name} failed; refresh your space list and login before retrying`)
    if (failure) throw failure
    return payload
  } catch (error: unknown) {
    // Do not propagate RPC error text/data from the credential broker.
    if (failure) throw failure
    if (error instanceof Error && error.name !== "AppServerRpcError") throw error
    throw new Error(`CodeM ${name} broker rejected the request; refresh your login and retry`)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", abort)
    child.kill("SIGKILL")
    await closed
    await peer.close()
  }
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid CodeM space response")
  return value as JsonObject
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid CodeM ${label}`)
  return value
}

function spaceKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Invalid CodeM space key")
  return value
}
