import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process"
import { isAbsolute } from "node:path"
import type { AppServerRuntime } from "./runtime.ts"

const AUTH_CAPTURE_LIMIT_BYTES = 8 * 1024
const AUTH_STATUS_OUTPUT_LIMIT_BYTES = 64 * 1024
const AUTH_LOGIN_OUTPUT_LIMIT_BYTES = 1024 * 1024
const DEFAULT_AUTH_STATUS_TIMEOUT_MS = 30_000
const DEFAULT_AUTH_CLOSE_TIMEOUT_MS = 2_000

export interface AppServerAuthStatus {
  readonly loggedIn: boolean
  readonly authMethod: string | null
  readonly routerCredential: boolean | null
  readonly serverUrl: string | null
  readonly tenantId: string | null
  readonly userId: string | null
  readonly displayName: string | null
}

export interface AppServerAuthenticationOptions {
  readonly runtime: AppServerRuntime
  readonly workingDirectory: string
  readonly environment?: NodeJS.ProcessEnv
  readonly statusTimeoutMs?: number
  readonly closeTimeoutMs?: number
}

export type AppServerLoginProgress = "authorization-ready" | "binding" | "authenticated"

export interface StartAppServerLoginOptions extends AppServerAuthenticationOptions {
  readonly serverUrl?: string
  readonly presentAuthorization: (authorizationUrl: string) => void | Promise<void>
  readonly onProgress?: (progress: AppServerLoginProgress) => void
}

export interface AppServerLoginOperation {
  readonly completed: Promise<AppServerAuthStatus>
  readonly cancel: () => Promise<void>
}

export class AppServerLoginCancelledError extends Error {
  constructor() {
    super("CodeM login was cancelled")
    this.name = "AppServerLoginCancelledError"
  }
}

export async function readAppServerAuthStatus(options: AppServerAuthenticationOptions): Promise<AppServerAuthStatus> {
  validateOptions(options)
  const result = await runCapturedAuthCommand(options, ["auth", "status", "--json"], {
    timeoutMs: options.statusTimeoutMs ?? DEFAULT_AUTH_STATUS_TIMEOUT_MS,
    stdoutLimitBytes: AUTH_STATUS_OUTPUT_LIMIT_BYTES,
    label: "authentication status",
  })
  const status = parseAuthStatus(result.stdout)
  if (status?.loggedIn === false && result.signal === null && (result.exitCode === 0 || result.exitCode === 1)) {
    return status
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    throw commandFailure("authentication status", result)
  }
  if (!status) throw new Error("CodeM authentication status returned invalid JSON")
  return status
}

export function assertAppServerAuthenticated(status: AppServerAuthStatus): void {
  if (!status.loggedIn) throw new Error("CodeM login is required before starting App Server threads")
  if (status.routerCredential !== true) {
    throw new Error("CodeM login cannot route tasks; sign out and sign in again")
  }
}

export function startAppServerLogin(options: StartAppServerLoginOptions): AppServerLoginOperation {
  validateOptions(options)
  const args = ["auth", "login", "--json", "--force"]
  if (options.serverUrl !== undefined) {
    const serverUrl = parseHttpsUrl(options.serverUrl, "login server URL")
    args.push("--server", serverUrl)
  }

  const child = spawnAuth(options, args)
  let stdoutBytes = 0
  let stderr = ""
  let lineBuffer = ""
  let terminalError: Error | null = null
  let lastEventType: string | null = null
  let authorizationPresentation: Promise<void> | null = null
  let cancelled = false
  const progress = new Set<AppServerLoginProgress>()

  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    stdoutBytes += Buffer.byteLength(chunk)
    if (stdoutBytes > AUTH_LOGIN_OUTPUT_LIMIT_BYTES) {
      fail(new Error(`CodeM login stdout exceeded ${AUTH_LOGIN_OUTPUT_LIMIT_BYTES} bytes`))
      return
    }
    lineBuffer += chunk
    consumeCompleteLines()
  })
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-AUTH_CAPTURE_LIMIT_BYTES)
  })

  const closed = processCompletion(child, "login")
  const completed = (async (): Promise<AppServerAuthStatus> => {
    const exit = await closed
    consumeLine(lineBuffer)
    if (cancelled) throw new AppServerLoginCancelledError()
    if (terminalError) throw terminalError
    if (exit.exitCode !== 0 || exit.signal !== null) {
      throw commandFailure("login", { ...exit, stdout: "", stderr })
    }
    if (lastEventType !== "login_success" || authorizationPresentation === null) {
      throw new Error("CodeM login ended without a successful authorization flow")
    }
    await authorizationPresentation
    const status = await readAppServerAuthStatus(options)
    assertAppServerAuthenticated(status)
    return status
  })()

  return {
    completed,
    cancel: async () => {
      if (cancelled || child.exitCode !== null || child.signalCode !== null) return
      cancelled = true
      await terminateAuthProcess(child, closed, options.closeTimeoutMs ?? DEFAULT_AUTH_CLOSE_TIMEOUT_MS)
    },
  }

  function consumeCompleteLines(): void {
    let newline = lineBuffer.indexOf("\n")
    while (newline >= 0) {
      const line = lineBuffer.slice(0, newline)
      lineBuffer = lineBuffer.slice(newline + 1)
      consumeLine(line)
      newline = lineBuffer.indexOf("\n")
    }
  }

  function consumeLine(rawLine: string): void {
    const line = rawLine.trim()
    if (!line || terminalError || cancelled) return
    const event = parseLoginEvent(line)
    if (!event) {
      fail(new Error("CodeM login emitted an invalid JSON event"))
      return
    }
    lastEventType = event.type
    if (event.type === "login_session") {
      if (authorizationPresentation !== null) {
        fail(new Error("CodeM login emitted more than one authorization session"))
        return
      }
      if (event.authorizationUrl === null) {
        fail(new Error("CodeM login did not provide an authorization URL"))
        return
      }
      let authorizationUrl: string
      try {
        authorizationUrl = parseHttpsUrl(event.authorizationUrl, "authorization URL")
      } catch (error: unknown) {
        fail(asError(error))
        return
      }
      if (!reportProgress("authorization-ready")) return
      authorizationPresentation = Promise.resolve().then(() => options.presentAuthorization(authorizationUrl))
      void authorizationPresentation.catch((error: unknown) => fail(asError(error)))
      return
    }
    if (event.type === "login_binding") {
      reportProgress("binding")
      return
    }
    if (event.type === "login_success") {
      reportProgress("authenticated")
      return
    }
    if (event.type === "login_error") {
      fail(new Error(event.message ?? event.code ?? "CodeM login failed"))
    }
  }

  function reportProgress(value: AppServerLoginProgress): boolean {
    if (progress.has(value)) return true
    progress.add(value)
    try {
      options.onProgress?.(value)
      return true
    } catch (error: unknown) {
      fail(asError(error))
      return false
    }
  }

  function fail(error: Error): void {
    if (terminalError || cancelled) return
    terminalError = error
    void terminateAuthProcess(child, closed, options.closeTimeoutMs ?? DEFAULT_AUTH_CLOSE_TIMEOUT_MS).catch(
      (terminationError: unknown) => {
        terminalError = new Error(`${error.message}; ${asError(terminationError).message}`, { cause: error })
      },
    )
  }
}

export async function signOutAppServer(options: AppServerAuthenticationOptions): Promise<AppServerAuthStatus> {
  validateOptions(options)
  const result = await runCapturedAuthCommand(options, ["auth", "logout"], {
    timeoutMs: options.statusTimeoutMs ?? DEFAULT_AUTH_STATUS_TIMEOUT_MS,
    stdoutLimitBytes: AUTH_STATUS_OUTPUT_LIMIT_BYTES,
    label: "logout",
  })
  if (result.exitCode !== 0 || result.signal !== null) throw commandFailure("logout", result)
  const status = await readAppServerAuthStatus(options)
  if (status.loggedIn) throw new Error("CodeM logout completed but the credential broker still reports signed in")
  return status
}

interface AuthCommandResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
}

async function runCapturedAuthCommand(
  options: AppServerAuthenticationOptions,
  args: readonly string[],
  command: { readonly timeoutMs: number; readonly stdoutLimitBytes: number; readonly label: string },
): Promise<AuthCommandResult> {
  requirePositiveTimeout(command.timeoutMs, command.label)
  const child = spawnAuth(options, args)
  let stdout = ""
  let stdoutBytes = 0
  let stderr = ""
  let terminalError: Error | null = null
  const completion = processCompletion(child, command.label)
  const timer = setTimeout(() => {
    terminalError = new Error(`CodeM ${command.label} timed out after ${command.timeoutMs}ms`)
    child.kill("SIGKILL")
  }, command.timeoutMs)
  timer.unref?.()

  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    stdoutBytes += Buffer.byteLength(chunk)
    if (stdoutBytes > command.stdoutLimitBytes && terminalError === null) {
      terminalError = new Error(`CodeM ${command.label} stdout exceeded ${command.stdoutLimitBytes} bytes`)
      child.kill("SIGKILL")
      return
    }
    if (terminalError === null) stdout += chunk
  })
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-AUTH_CAPTURE_LIMIT_BYTES)
  })

  try {
    const exit = await completion
    if (terminalError) throw terminalError
    return { ...exit, stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}

function spawnAuth(options: AppServerAuthenticationOptions, args: readonly string[]): ChildProcessWithoutNullStreams {
  const spawnOptions: SpawnOptionsWithoutStdio = {
    cwd: options.workingDirectory,
    env: options.environment ?? process.env,
    windowsHide: true,
  }
  const child = spawn(options.runtime.authExecutablePath, args, spawnOptions)
  child.stdin.end()
  return child
}

function processCompletion(
  child: ChildProcessWithoutNullStreams,
  label: string,
): Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      reject(new Error(`Could not start CodeM ${label}: ${error.message}`, { cause: error }))
    })
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }))
  })
}

async function terminateAuthProcess(
  child: ChildProcessWithoutNullStreams,
  completion: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  requirePositiveTimeout(timeoutMs, "authentication close")
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
  if (await waitForCompletion(completion, timeoutMs)) return
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  if (await waitForCompletion(completion, timeoutMs)) return
  throw new Error("CodeM authentication process did not exit after SIGTERM and SIGKILL")
}

async function waitForCompletion(completion: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      completion.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function parseAuthStatus(text: string): AppServerAuthStatus | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(value) || typeof value.loggedIn !== "boolean") return null
  const authMethod = optionalString(value.authMethod)
  const routerCredential = optionalBoolean(value.routerCredential)
  const serverUrl = optionalString(value.serverUrl)
  const tenantId = optionalString(value.tenantId)
  const userId = optionalString(value.userId)
  const displayName = optionalString(value.displayName)
  if (
    authMethod === undefined ||
    routerCredential === undefined ||
    serverUrl === undefined ||
    tenantId === undefined ||
    userId === undefined ||
    displayName === undefined
  ) {
    return null
  }
  return { loggedIn: value.loggedIn, authMethod, routerCredential, serverUrl, tenantId, userId, displayName }
}

function parseLoginEvent(line: string): {
  readonly type: string
  readonly authorizationUrl: string | null
  readonly code: string | null
  readonly message: string | null
} | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObject(value) || typeof value.type !== "string" || !value.type.trim()) return null
  return {
    type: value.type,
    authorizationUrl: eventString(value.authorizationUrl),
    code: eventString(value.code),
    message: eventString(value.message),
  }
}

function parseHttpsUrl(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch (error: unknown) {
    throw new Error(`CodeM ${label} is invalid`, { cause: error })
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`CodeM ${label} must be an HTTPS URL without embedded credentials`)
  }
  return url.toString()
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === "string" ? value : undefined
}

function optionalBoolean(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === "boolean" ? value : undefined
}

function eventString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function commandFailure(label: string, result: AuthCommandResult): Error {
  return new Error(`CodeM ${label} failed (exit=${String(result.exitCode)}, signal=${String(result.signal)})`)
}

function validateOptions(options: AppServerAuthenticationOptions): void {
  if (!isAbsolute(options.workingDirectory)) {
    throw new Error(`CodeM authentication workingDirectory must be absolute: ${options.workingDirectory}`)
  }
  requirePositiveTimeout(options.statusTimeoutMs, "authentication status")
  requirePositiveTimeout(options.closeTimeoutMs, "authentication close")
}

function requirePositiveTimeout(value: number | undefined, label: string): void {
  if (value === undefined) return
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`CodeM ${label} timeout must be positive: ${String(value)}`)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
