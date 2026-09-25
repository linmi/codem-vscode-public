import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import { isAbsolute } from "node:path"
import { validateAppServerInitializeResult, type AppServerInitialization } from "./preflight.ts"
import { CORE_APP_SERVER_TERMINATION, requirePositiveTimeout, terminateChildProcess } from "./processLifecycle.ts"
import { AppServerRpcPeer, type AppServerNotification, type AppServerRequest, type JsonObject } from "./rpc.ts"
import type { AppServerRuntime } from "./runtime.ts"

const DEFAULT_INITIALIZE_TIMEOUT_MS = 5_000

export interface AppServerClientInfo {
  readonly name: string
  readonly version: string
}

export interface AppServerProcessExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly expected: boolean
}

export interface StartAppServerConnectionOptions {
  readonly runtime: AppServerRuntime
  readonly workingDirectory: string
  readonly clientInfo: AppServerClientInfo
  readonly arguments?: readonly string[]
  readonly environment?: NodeJS.ProcessEnv
  readonly initializeTimeoutMs?: number
  readonly closeTimeoutMs?: number
  readonly onNotification?: (notification: AppServerNotification) => void
  readonly onRequest?: (request: AppServerRequest, peer: AppServerRpcPeer) => void
  /**
   * Failures no call can return: protocol violations, process errors after start, callback
   * failures, and a Core that outlives the cleanup after a failed start.
   */
  readonly onProtocolError?: (error: Error) => void
  readonly onStderr?: (text: string) => void
  readonly onExit?: (exit: AppServerProcessExit) => void
}

export class AppServerConnection {
  readonly runtime: AppServerRuntime
  readonly initialization: AppServerInitialization
  readonly responseJsonrpc: "2.0" | "omitted"
  readonly peer: AppServerRpcPeer
  private readonly child: ChildProcessWithoutNullStreams
  private readonly completion: Promise<Omit<AppServerProcessExit, "expected">>
  private readonly closeTimeoutMs: number
  private expectedClose = false
  private closePromise: Promise<void> | null = null

  constructor(
    runtime: AppServerRuntime,
    initialization: AppServerInitialization,
    responseJsonrpc: "2.0" | "omitted",
    peer: AppServerRpcPeer,
    child: ChildProcessWithoutNullStreams,
    completion: Promise<Omit<AppServerProcessExit, "expected">>,
    closeTimeoutMs: number,
  ) {
    this.runtime = runtime
    this.initialization = initialization
    this.responseJsonrpc = responseJsonrpc
    this.peer = peer
    this.child = child
    this.completion = completion
    this.closeTimeoutMs = closeTimeoutMs
  }

  request(method: string, params: JsonObject = {}): Promise<unknown> {
    return this.peer.request(method, params)
  }

  notify(method: string, params: JsonObject = {}): void {
    this.peer.notify(method, params)
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.expectedClose = true
    this.closePromise = this.closeProcess()
    return this.closePromise
  }

  isExpectedClose(): boolean {
    return this.expectedClose
  }

  private async closeProcess(): Promise<void> {
    const peerClose = this.peer.close()
    await terminateChildProcess(this.child, this.completion, { ...CORE_APP_SERVER_TERMINATION, stepTimeoutMs: this.closeTimeoutMs })
    await peerClose
  }
}

export async function startAppServerConnection(options: StartAppServerConnectionOptions): Promise<AppServerConnection> {
  validateOptions(options)
  let expectedClose = false
  let connection: AppServerConnection | null = null
  const child = spawn(options.runtime.executablePath, [...(options.arguments ?? []), "app-server"], {
    cwd: options.workingDirectory,
    env: options.environment ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const completion = new Promise<Omit<AppServerProcessExit, "expected">>((resolve) => {
    child.once("close", (code, signal) => {
      const exit = { code, signal }
      try {
        options.onExit?.({ ...exit, expected: expectedClose || connection?.isExpectedClose() === true })
      } catch (error: unknown) {
        reportProtocolError(options.onProtocolError, callbackError("onExit", error))
      } finally {
        resolve(exit)
      }
    })
  })
  await waitForSpawn(child)
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (text: string) => {
    try {
      options.onStderr?.(text)
    } catch (error: unknown) {
      reportProtocolError(options.onProtocolError, callbackError("onStderr", error))
    }
  })
  let peer!: AppServerRpcPeer
  peer = new AppServerRpcPeer({
    stdin: child.stdin,
    stdoutLines: createInterface({ input: child.stdout, crlfDelay: Infinity }),
    onNotification: (notification) => options.onNotification?.(notification),
    onRequest: (request) => {
      if (options.onRequest) options.onRequest(request, peer)
      else peer.respondError(request.id, -32601, `Unsupported client request: ${request.method}`)
    },
    onProtocolError: (error) => {
      reportProtocolError(options.onProtocolError, error)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
    },
  })
  child.on("error", (error) => {
    reportProtocolError(
      options.onProtocolError,
      new Error(`CodeM App Server process failed after start: ${error.message}`, { cause: error }),
    )
  })

  const initializeRequest = peer.requestAbandonable("initialize", { clientInfo: options.clientInfo })
  try {
    const result = await withTimeout(
      initializeRequest.response,
      options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
      () => initializeRequest.abandon(),
      "CodeM App Server initialize",
    )
    const initialization = validateAppServerInitializeResult(result, options.runtime)
    const responseJsonrpc = peer.responseJsonrpc
    if (responseJsonrpc === null) throw new Error("CodeM App Server initialize response shape was not recorded")
    peer.notify("initialized")
    connection = new AppServerConnection(
      options.runtime,
      initialization,
      responseJsonrpc,
      peer,
      child,
      completion,
      options.closeTimeoutMs ?? CORE_APP_SERVER_TERMINATION.stepTimeoutMs,
    )
    return connection
  } catch (error: unknown) {
    expectedClose = true
    const peerClose = peer.close().catch(() => undefined)
    // The startup failure stays the rejection, unchanged. A Core that outlives its cleanup is reported, not thrown in its place.
    const reaped = await terminateChildProcess(child, completion, {
      ...CORE_APP_SERVER_TERMINATION,
      stepTimeoutMs: options.closeTimeoutMs ?? CORE_APP_SERVER_TERMINATION.stepTimeoutMs,
    }).then(
      () => true,
      (cleanupError: unknown) => {
        reportProtocolError(options.onProtocolError, startupCleanupError(cleanupError))
        return false
      },
    )
    // A surviving process can keep stdout open, so only a reaped child's reader is awaited.
    if (reaped) await peerClose
    throw error
  }
}

function validateOptions(options: StartAppServerConnectionOptions): void {
  if (!isAbsolute(options.workingDirectory)) {
    throw new Error(`CodeM App Server workingDirectory must be absolute: ${options.workingDirectory}`)
  }
  if (!options.clientInfo.name.trim() || !options.clientInfo.version.trim()) {
    throw new Error("CodeM App Server clientInfo name and version must be non-empty")
  }
  requirePositiveTimeout(options.initializeTimeoutMs, "App Server initialize")
  requirePositiveTimeout(options.closeTimeoutMs, "App Server close")
}

function waitForSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError)
      resolve()
    }
    const onError = (error: Error) => {
      child.off("spawn", onSpawn)
      reject(new Error(`Could not start CodeM App Server: ${error.message}`, { cause: error }))
    }
    child.once("spawn", onSpawn)
    child.once("error", onError)
  })
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout()
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function reportProtocolError(callback: ((error: Error) => void) | undefined, error: Error): void {
  try {
    callback?.(error)
  } catch {
    // A diagnostic callback must never break process cleanup or leave RPC requests pending.
  }
}

function callbackError(name: string, value: unknown): Error {
  const cause = value instanceof Error ? value : new Error(String(value))
  return new Error(`CodeM App Server ${name} callback failed: ${cause.message}`, { cause })
}

function startupCleanupError(value: unknown): Error {
  const cause = value instanceof Error ? value : new Error(String(value))
  return new Error(`CodeM App Server startup cleanup failed: ${cause.message}`, { cause })
}
