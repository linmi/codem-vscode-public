import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { isAbsolute } from "node:path"
import { resolveAppServerRuntime, type AppServerRuntime } from "./runtime.ts"

export const APP_SERVER_PROTOCOL_VERSION = 1

export const REQUIRED_APP_SERVER_BOOLEAN_CAPABILITIES = [
  "threads.list",
  "threads.read",
  "threads.fork",
  "threads.archive",
  "threads.delete",
  "threads.setName",
  "threads.compact",
  "threads.turnsList",
  "threads.itemsList",
  "threads.shellCommand",
  "threads.backgroundTerminals",
  "threads.backgroundTaskCancel",
  "threads.rewind",
  "threads.initialPlanMode",
  "threads.modelSelection",
  "turns.steer",
  "turns.interrupt",
  "turns.attachments",
  "items.streaming",
  "clientRequests.commandExecutionApproval",
  "clientRequests.fileChangeApproval",
  "clientRequests.permissionsApproval",
  "clientRequests.planApproval",
  "clientRequests.rewindSelection",
  "clientRequests.userInput",
  "controlPlane.configRead",
  "controlPlane.environment",
  "controlPlane.hooks",
  "controlPlane.models",
  "controlPlane.permissionProfiles",
  "controlPlane.plugins",
  "controlPlane.skills",
  "controlPlane.spaces",
  "controlPlane.tools",
  "mcp.stdio",
] as const

export const REQUIRED_APP_SERVER_ITEM_TYPES = [
  "userMessage",
  "agentMessage",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "webSearch",
  "contextCompaction",
  "toolCall",
  "subagent",
] as const

export const REQUIRED_APP_SERVER_ITEM_STATUSES = [
  "inProgress",
  "completed",
  "failed",
  "declined",
  "interrupted",
] as const

const PREFLIGHT_REQUEST_ID = "codem-vscode-preflight"
const DEFAULT_TIMEOUT_MS = 5_000
const MAX_OUTPUT_BYTES = 1024 * 1024

export interface PreflightAppServerOptions {
  readonly packageRoot: string
  readonly workingDirectory: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly timeoutMs?: number
}

export interface AppServerPreflight {
  readonly target: AppServerRuntime["target"]
  readonly packageName: string
  readonly coreVersion: string
  readonly executablePath: string
  readonly licensePath: string
  readonly sha256: string
  readonly protocolVersion: number
  readonly agentVersion: string
  readonly responseJsonrpc: "2.0" | "omitted"
}

export interface AppServerInitialization {
  readonly protocolVersion: typeof APP_SERVER_PROTOCOL_VERSION
  readonly agentVersion: string
}

export function validateAppServerInitializeResult(
  value: unknown,
  runtime: Pick<AppServerRuntime, "coreVersion" | "executablePath">,
): AppServerInitialization {
  const initialized = asObject(value, "initialize result")
  if (initialized.protocolVersion !== APP_SERVER_PROTOCOL_VERSION) {
    throw new Error(
      `CodeM App Server protocol ${String(initialized.protocolVersion)} is not supported; expected ${APP_SERVER_PROTOCOL_VERSION}`,
    )
  }
  const capabilities = asObject(initialized.capabilities, "initialize capabilities")
  validateCapabilities(capabilities)
  const agentInfo = asObject(initialized.agentInfo, "initialize agentInfo")
  if (typeof agentInfo.version !== "string" || !agentInfo.version.trim()) {
    throw new Error("CodeM App Server initialize agentInfo.version must be non-empty")
  }
  const runtimeVersion = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$/u.exec(agentInfo.version)?.[1]
  if (runtimeVersion !== runtime.coreVersion) {
    throw new Error(
      `CodeM App Server Core is ${runtime.coreVersion}, but ${runtime.executablePath} reports ${agentInfo.version}`,
    )
  }
  return {
    protocolVersion: APP_SERVER_PROTOCOL_VERSION,
    agentVersion: agentInfo.version,
  }
}

export function preflightAppServer(options: PreflightAppServerOptions): AppServerPreflight {
  const runtime = resolveAppServerRuntime({
    packageRoot: options.packageRoot,
    platform: options.platform,
    arch: options.arch,
  })
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!isAbsolute(options.workingDirectory)) {
    throw new Error(`CodeM App Server workingDirectory must be absolute: ${options.workingDirectory}`)
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`CodeM App Server preflight timeout must be positive: ${String(timeoutMs)}`)
  }

  const request = {
    jsonrpc: "2.0",
    id: PREFLIGHT_REQUEST_ID,
    method: "initialize",
    params: { clientInfo: { name: "codem-vscode", version: "0.1.0" } },
  }
  const result = spawnSync(runtime.executablePath, ["app-server"], {
    cwd: options.workingDirectory,
    env: options.environment ?? process.env,
    encoding: "utf8",
    input: `${JSON.stringify(request)}\n`,
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  })

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === "ETIMEDOUT") {
      throw new Error(`CodeM App Server initialize timed out after ${timeoutMs}ms`)
    }
    throw new Error(`Could not run CodeM App Server initialize: ${result.error.message}`, {
      cause: result.error,
    })
  }
  if (result.status !== 0) {
    throw new Error(
      `CodeM App Server initialize exited with status ${String(result.status)}: ${outputContext(result.stderr)}`,
    )
  }

  const lines = result.stdout.split(/\r?\n/u).filter((line) => line.trim())
  if (lines.length !== 1) {
    throw new Error(`CodeM App Server initialize expected one RPC response, received ${lines.length}`)
  }
  const parsed = parseResponse(lines[0])
  const initialized = validateAppServerInitializeResult(parsed.response.result, runtime)

  return {
    ...runtime,
    sha256: createHash("sha256").update(readFileSync(runtime.executablePath)).digest("hex"),
    ...initialized,
    responseJsonrpc: parsed.jsonrpc,
  }
}

function parseResponse(line: string): {
  readonly response: Record<string, unknown>
  readonly jsonrpc: "2.0" | "omitted"
} {
  let response: unknown
  try {
    response = JSON.parse(line)
  } catch (error: unknown) {
    throw new Error(`CodeM App Server initialize returned invalid JSON: ${outputContext(line)}`, {
      cause: error,
    })
  }
  if (!isObject(response)) {
    throw new Error("CodeM App Server initialize response must be a JSON-RPC 2.0 object")
  }
  const jsonrpc = "jsonrpc" in response ? response.jsonrpc : undefined
  if (jsonrpc !== undefined && jsonrpc !== "2.0") {
    const actual = JSON.stringify(jsonrpc)
    throw new Error(`CodeM App Server initialize response jsonrpc must be \"2.0\"; received ${actual}`)
  }
  if (response.id !== PREFLIGHT_REQUEST_ID) {
    throw new Error(`CodeM App Server initialize response id does not match ${PREFLIGHT_REQUEST_ID}`)
  }
  if (isObject(response.error)) {
    throw new Error(`CodeM App Server initialize failed: ${String(response.error.message ?? "unknown error")}`)
  }
  if (!("result" in response)) {
    throw new Error("CodeM App Server initialize response omitted result")
  }
  return { response, jsonrpc: jsonrpc === "2.0" ? "2.0" : "omitted" }
}

function validateCapabilities(capabilities: Record<string, unknown>): void {
  for (const path of REQUIRED_APP_SERVER_BOOLEAN_CAPABILITIES) {
    if (nestedValue(capabilities, path) !== true) {
      throw new Error(`CodeM App Server is missing required capability ${path}=true`)
    }
  }
  requireArrayMembers(capabilities, "items.types", REQUIRED_APP_SERVER_ITEM_TYPES)
  requireArrayMembers(capabilities, "items.statuses", REQUIRED_APP_SERVER_ITEM_STATUSES)
}

function requireArrayMembers(capabilities: Record<string, unknown>, path: string, required: readonly string[]): void {
  const value = nestedValue(capabilities, path)
  if (!Array.isArray(value)) {
    throw new Error(`CodeM App Server capability ${path} must be an array`)
  }
  for (const member of required) {
    if (!value.includes(member)) {
      throw new Error(`CodeM App Server capability ${path} is missing ${member}`)
    }
  }
}

function nestedValue(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value
  for (const segment of path.split(".")) {
    if (!isObject(current)) return undefined
    current = current[segment]
  }
  return current
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`CodeM App Server ${label} must be an object`)
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function outputContext(value: unknown): string {
  const text = String(value ?? "").trim()
  return text ? text.slice(0, 500) : "<no output>"
}
