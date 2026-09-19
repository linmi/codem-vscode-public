/**
 * Local DTOs for leftover Kilo surfaces that still post through the Webview.
 * These are not Core / App Server catalog types. Do not import leftover SDK.
 */

export type IndexingStatusState = "Disabled" | "In Progress" | "Complete" | "Error" | "Standby"

export type IndexingStatus = {
  state: IndexingStatusState
  message: string
  processedFiles: number
  totalFiles: number
  percent: number
}

export type ProviderAuthMethod = {
  type: "oauth" | "api"
  label: string
  prompts?: Array<
    | {
        type: "text"
        key: string
        message: string
        placeholder?: string
        when?: {
          key: string
          op: "eq" | "neq"
          value: string
        }
      }
    | {
        type: "select"
        key: string
        message: string
        options: Array<{
          label: string
          value: string
          hint?: string
        }>
        when?: {
          key: string
          op: "eq" | "neq"
          value: string
        }
      }
  >
}

export type ProviderAuthAuthorization = {
  url: string
  method: "auto" | "code"
  instructions: string
}

export type SessionModelUsage = {
  sessionIDs: Array<string>
  totals: {
    steps: number
    cost: number
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
  }
  models: Array<{
    providerID: string
    modelID: string
    steps: number
    cost: number
    tokens: {
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
  }>
}

export type MemoryStatusState = {
  version: 1
  enabled: boolean
  scope: "project"
  autoInject: boolean
  autoConsolidate: boolean
  verbose: boolean
  capture: {
    mode: "selective"
    turnClose: boolean
    explicit: boolean
    maxOpsPerRun: number
    minIntervalMs: number
    timeoutMs: number
  }
  limits: {
    maxProjectIndexBytes: number
    maxSessionFiles: number
    maxRecentSessions: number
    maxConsolidationInputBytes: number
    maxLineChars: number
    maxSessionLineChars: number
  }
  stats: {
    lastInjectedAt: number
    lastInjectedBytes: number
    lastInjectedTokens: number
    lastInjectedSessionID: string
    lastTypedConsolidationAt: number
    lastSessionSavedAt: number
    lastConsolidationCost: number
    lastConsolidationTokens: number
    lastOperationCount: number
    lastRecallAt: number
    lastRecallCount: number
    lastRecallSessionID: string
  }
}

export type MemoryStatusResponse = {
  root: string
  state: MemoryStatusState
  exists: {
    state: boolean
    index: boolean
  }
  index: {
    bytes: number
    estimatedTokens: number
    preview: string
  }
}

export type MemoryEnableResponse = MemoryStatusResponse
export type MemoryConfigureResponse = MemoryStatusResponse
export type MemoryDisableResponse = MemoryStatusResponse
export type MemoryForgetResponse = MemoryStatusResponse
export type MemoryPurgeResponse = MemoryStatusResponse
export type MemoryRememberResponse = MemoryStatusResponse
export type MemoryCorrectResponse = MemoryStatusResponse
export type MemoryRebuildResponse = MemoryStatusResponse

export type MemorySourceFile = "project.md" | "environment.md" | "corrections.md"

export const MEMORY_COMMAND_CATALOG = [
  { usage: "on", description: "Enable project memory" },
  { usage: "off", description: "Disable project memory" },
  { usage: "status", description: "Storage location and stored memory overview" },
  { usage: "show", description: "Stored project memory overview" },
  { usage: "remember <text>", description: "Save a project memory note" },
  { usage: "correct <text>", description: "Save a correction to project memory" },
  { usage: "forget <query>", description: "Remove matching project memory" },
  { usage: "auto on|off", description: "Turn automatic memory saves on or off" },
  { usage: "inspect", description: "Reveal the project memory folder" },
  { usage: "rebuild", description: "Rebuild the memory index from source files" },
  { usage: "purge confirm", description: "Delete all project memory files" },
] as const

export const MEMORY_USAGE = `/memory [project] ${MEMORY_COMMAND_CATALOG.map((item) => item.usage).join("|")}`

export const MEMORY_OPERATIONS = [
  "enable",
  "status",
  "inspect",
  "disable",
  "rebuild",
  "remember",
  "correct",
  "forget",
  "purge",
  "auto",
] as const

export type MemoryOperation = (typeof MEMORY_OPERATIONS)[number]

export function isMemoryOperation(input: unknown): input is MemoryOperation {
  return typeof input === "string" && (MEMORY_OPERATIONS as readonly string[]).includes(input)
}

export type ProviderUsagePeriod = {
  unit: "hour" | "day" | "week" | "month"
  value: number
}

export type ProviderUsageWindow = {
  id: string
  resource: string
  unit: string
  orientation: "used_percent" | "remaining_percent" | "amount" | "count"
  used?: number
  remaining?: number
  limit?: number
  period?: ProviderUsagePeriod
  durationMs?: number
  resetAt?: string
  state: "active" | "exhausted" | "unlimited" | "not_in_plan" | "unknown"
}

export type ProviderUsageError = {
  code: string
  message: string
  retryable: boolean
}

export type ProviderUsageSnapshot = {
  id: string
  providerID: string
  sourceKind: "kilo_managed" | "direct"
  providerLabel: string
  planLabel: string
  sourceLabel: string
  fetchState: "ready" | "stale" | "unavailable" | "error"
  planState: "active" | "past_due" | "canceling" | "unknown"
  routingState: "active" | "disabled" | "missing" | "replaced" | "not_applicable" | "unknown"
  fetchedAt?: string
  managementUrl?: string
  windows: Array<ProviderUsageWindow>
  error?: ProviderUsageError
}

export type ProviderUsage = {
  items: Array<ProviderUsageSnapshot>
  generatedAt: string
}

export type BoardMessage = {
  id: string
  timestamp: number
  from: string
  to: string
  fromLabel?: string
  toLabel?: string
  type: "INFO" | "ASK" | "RESULT" | "HOLD" | "VETO"
  body: string
  reply_to?: string
}

export type SessionBoard = {
  ownerSessionID: string
  revision: number
  messages: Array<BoardMessage>
  cursor?: string
  hasMore: boolean
}

export type { AnacondaDesktopStatus } from "../../../../src/shared/anaconda-desktop-messages.ts"
