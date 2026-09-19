import type {
  MemoryCorrectResponse,
  MemoryConfigureResponse,
  MemoryDisableResponse,
  MemoryEnableResponse,
  MemoryForgetResponse,
  MemoryPurgeResponse,
  MemoryRememberResponse,
  MemoryRebuildResponse,
  MemoryStatusResponse,
  MemoryOperation,
  MemorySourceFile,
} from "./leftover"

export type { MemorySourceFile, MemoryOperation }

export type MemoryResultOperation = MemoryOperation

export type MemoryOperationResponse =
  | MemoryEnableResponse
  | MemoryConfigureResponse
  | MemoryDisableResponse
  | MemoryStatusResponse
  | MemoryRebuildResponse
  | MemoryRememberResponse
  | MemoryCorrectResponse
  | MemoryForgetResponse
  | MemoryPurgeResponse

export interface MemoryLoadedMessage {
  type: "memoryLoaded"
  sessionID?: string
  status?: MemoryStatusResponse
  error?: string
}

export interface MemoryEventDetail {
  type?: "saved" | "skipped" | "recalled" | "error"
  message?: string
  reason?: string
  duplicateOf?: string
  tokens?: number
  operationCount?: number
  added?: number
  removed?: number
  skippedCount?: number
  sources?: string[]
  files?: string[]
}

export interface MemoryEventMessage {
  type: "memoryEvent"
  sessionID?: string
  detail: MemoryEventDetail
}

export interface MemoryOperationResultMessage {
  type: "memoryOperationResult"
  operation: MemoryResultOperation
  sessionID?: string
  ok: boolean
  status?: MemoryStatusResponse
  result?: MemoryOperationResponse
  error?: string
}

