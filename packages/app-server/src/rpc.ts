import type { Writable } from "node:stream"
import {
  AbandonedRpcRequests,
  APP_SERVER_ABANDONED_REQUEST_LIMIT,
  APP_SERVER_ABANDONED_REQUEST_TTL_MS,
} from "./rpcAbandoned.ts"

export type JsonObject = Record<string, unknown>
export { APP_SERVER_ABANDONED_REQUEST_LIMIT, APP_SERVER_ABANDONED_REQUEST_TTL_MS }

export interface AppServerNotification {
  readonly method: string
  readonly params: JsonObject
}

export interface AppServerRequest extends AppServerNotification {
  readonly id: string | number
}

interface RpcFailure {
  readonly id: string | number | null
  readonly error: {
    readonly code: number
    readonly message: string
    readonly data?: unknown
  }
}

interface PendingRequest {
  readonly method: string
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
}

export interface AppServerAbandonableRequest {
  readonly response: Promise<unknown>
  readonly abandon: () => void
}

export interface AppServerRpcPeerOptions {
  readonly stdin: Writable
  readonly stdoutLines: AsyncIterable<string>
  readonly onNotification: (notification: AppServerNotification) => void
  readonly onRequest: (request: AppServerRequest) => void
  readonly onProtocolError: (error: Error) => void
}

export class AppServerRpcError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(method: string, failure: RpcFailure["error"]) {
    super(`CodeM App Server ${method} failed (${failure.code}): ${failure.message}`, {
      cause: failure.data,
    })
    this.name = "AppServerRpcError"
    this.code = failure.code
    this.data = failure.data
  }
}

export class AppServerRpcPeer {
  private readonly options: AppServerRpcPeerOptions
  private readonly pending = new Map<string, PendingRequest>()
  private readonly abandoned: AbandonedRpcRequests
  private nextRequestId = 1
  private closed = false
  private protocolFailed = false
  private readonly readPromise: Promise<void>
  private observedResponseJsonrpc: "2.0" | "omitted" | null = null

  constructor(options: AppServerRpcPeerOptions) {
    this.options = options
    this.abandoned = new AbandonedRpcRequests((error) => this.failProtocol(error))
    this.readPromise = this.readLoop()
  }

  async request(method: string, params: JsonObject = {}): Promise<unknown> {
    return this.requestAbandonable(method, params).response
  }

  requestAbandonable(method: string, params: JsonObject = {}): AppServerAbandonableRequest {
    const id = this.nextRequestId++
    const key = String(id)
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(key, { method, resolve, reject })
    })
    try {
      this.write({ id, method, params })
    } catch (error: unknown) {
      this.pending.delete(key)
      throw error
    }
    return {
      response,
      abandon: () => {
        if (!this.pending.delete(key)) return
        this.abandoned.add(key, method)
      },
    }
  }

  get pendingRequestCount(): number {
    return this.pending.size
  }

  get abandonedRequestCount(): number {
    return this.abandoned.size
  }

  get responseJsonrpc(): "2.0" | "omitted" | null {
    return this.observedResponseJsonrpc
  }

  notify(method: string, params: JsonObject = {}): void {
    this.write({ method, params })
  }

  respond(id: string | number, result: unknown): void {
    this.write({ id, result })
  }

  respondError(id: string | number, code: number, message: string, data?: unknown): void {
    this.write({
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    })
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.abandoned.clear()
      this.options.stdin.end()
      this.rejectPending(new Error("CodeM App Server connection closed"))
    }
    await this.readPromise
  }

  private async readLoop(): Promise<void> {
    try {
      for await (const line of this.options.stdoutLines) {
        if (!line.trim()) continue
        this.consume(line)
      }
      if (!this.closed) {
        this.closed = true
        this.rejectPending(new Error("CodeM App Server closed stdout unexpectedly"))
      }
    } catch (error: unknown) {
      this.failProtocol(asError(error))
    } finally {
      this.abandoned.clear()
    }
  }

  private consume(line: string): void {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error: unknown) {
      throw new Error("CodeM App Server stdout contained invalid JSON", { cause: error })
    }
    if (!isObject(value) || ("jsonrpc" in value && value.jsonrpc !== "2.0")) {
      throw new Error("CodeM App Server emitted an invalid RPC frame")
    }
    const responseJsonrpc = value.jsonrpc === "2.0" ? "2.0" : "omitted"
    if ("method" in value) {
      if (typeof value.method !== "string" || !value.method.trim() || !isObject(value.params ?? {})) {
        throw new Error("CodeM App Server emitted an invalid method frame")
      }
      const frame = { method: value.method, params: (value.params ?? {}) as JsonObject }
      if ("id" in value) {
        if (!isRpcId(value.id)) throw new Error("CodeM App Server emitted a request with an invalid id")
        this.options.onRequest({ ...frame, id: value.id })
      } else {
        this.options.onNotification(frame)
      }
      return
    }
    if (!("id" in value) || !isRpcId(value.id)) {
      throw new Error("CodeM App Server emitted an uncorrelated response")
    }
    this.observedResponseJsonrpc = responseJsonrpc
    const key = String(value.id)
    const pending = this.pending.get(key)
    if (!pending) {
      if (this.closed || this.abandoned.consume(key)) return
      throw new Error(`CodeM App Server responded to unknown request ${String(value.id)}`)
    }
    this.pending.delete(key)
    if ("error" in value) {
      if (!isRpcFailure(value)) {
        const error = new Error("CodeM App Server emitted an invalid error")
        pending.reject(error)
        throw error
      }
      pending.reject(new AppServerRpcError(pending.method, value.error))
      return
    }
    if (!("result" in value)) {
      const error = new Error(`CodeM App Server ${pending.method} omitted its result`)
      pending.reject(error)
      throw error
    }
    pending.resolve(value.result)
  }

  private write(value: JsonObject): void {
    if (this.closed || !this.options.stdin.writable) {
      throw new Error("CodeM App Server stdin is not writable")
    }
    this.options.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...value })}\n`)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private failProtocol(error: Error): void {
    if (this.protocolFailed) return
    this.protocolFailed = true
    this.closed = true
    this.abandoned.clear()
    this.rejectPending(error)
    this.options.onProtocolError(error)
  }
}

function isRpcFailure(value: JsonObject): value is JsonObject & RpcFailure {
  if (!isObject(value.error)) return false
  return typeof value.error.code === "number" && typeof value.error.message === "string"
}

function isRpcId(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
