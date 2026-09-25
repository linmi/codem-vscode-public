import { APP_SERVER_ITEM_STATUSES, APP_SERVER_ITEM_TYPES, type AppServerItemType } from "./items.ts"
import type { AppServerRuntime } from "./runtime.ts"

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
  "threads.sessionModes",
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

/**
 * `toolResult` only appears in durable `thread/items/list` records. Pinned Core does not announce it in
 * `initialize` (see packages/contracts/core/initializeHandshake.json), so requiring it would reject Core.
 */
const DURABLE_ONLY_ITEM_TYPES: readonly AppServerItemType[] = ["toolResult"]

/** Item kinds Core must announce in `initialize`: every kind the Host parses, minus the durable-only ones. */
export const REQUIRED_APP_SERVER_ITEM_TYPES: readonly AppServerItemType[] = APP_SERVER_ITEM_TYPES.filter(
  (type) => !DURABLE_ONLY_ITEM_TYPES.includes(type),
)

export const REQUIRED_APP_SERVER_ITEM_STATUSES = APP_SERVER_ITEM_STATUSES

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
