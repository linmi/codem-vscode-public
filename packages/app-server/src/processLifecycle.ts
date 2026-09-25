import { spawn, type ChildProcess } from "node:child_process"

/**
 * Termination policy for one kind of child process: SIGTERM, then SIGKILL one step later.
 * Every wait is bounded, and a process that outlives SIGKILL is reported as an error.
 */
export interface GracefulTermination {
  readonly escalation: "graceful"
  /** Names the process in the error raised when it does not exit. */
  readonly processName: string
  /** Signal the whole tree: the POSIX process group (spawn with `terminationSpawnOptions`) or `taskkill /t`. */
  readonly tree: boolean
  /** The caller has closed stdin and the child exits on EOF, so the first step waits before any signal. */
  readonly exitsOnStdinClose: boolean
  /** Bound for each wait: after stdin close, after SIGTERM and after SIGKILL. */
  readonly stepTimeoutMs: number
}

/**
 * SIGKILL at once. The wait for the caller's exit promise is not bounded: callers return
 * only after the process has closed.
 */
export interface ImmediateTermination {
  readonly escalation: "immediate"
  readonly tree: boolean
}

export type ProcessTermination = GracefulTermination | ImmediateTermination

/**
 * Core gets stdin EOF first. Three 2 s steps plus the Host's 1 s release keep the 7 s
 * shutdown budget in docs/qualityGates.md.
 */
export const CORE_APP_SERVER_TERMINATION: GracefulTermination = {
  escalation: "graceful",
  processName: "CodeM App Server",
  tree: false,
  exitsOnStdinClose: true,
  stepTimeoutMs: 2_000,
}

/** `auth login` waits on the browser with stdin closed at spawn, so SIGTERM comes first. */
export const AUTH_LOGIN_TERMINATION: GracefulTermination = {
  escalation: "graceful",
  processName: "CodeM authentication process",
  tree: false,
  exitsOnStdinClose: false,
  stepTimeoutMs: 2_000,
}

/** `auth status` and `auth logout` are killed on deadline, cancellation or oversized output. */
export const AUTH_COMMAND_TERMINATION: ImmediateTermination = { escalation: "immediate", tree: false }
export const AUTH_COMMAND_DEADLINE_MS = 30_000

/** The credential broker is killed once its answer is read, and on deadline, cancellation or protocol failure. */
export const SPACE_BROKER_TERMINATION: ImmediateTermination = { escalation: "immediate", tree: false }
/** Covers every call made through one broker process, including list and prepare at startup. */
export const SPACE_BROKER_DEADLINE_MS = 180_000

/** Plugin commands can start helpers of their own, so the whole tree is signalled. */
export const PLUGIN_COMMAND_TERMINATION: GracefulTermination = {
  escalation: "graceful",
  processName: "CodeM plugin command",
  tree: true,
  exitsOnStdinClose: false,
  stepTimeoutMs: 1_000,
}
export const PLUGIN_COMMAND_DEADLINE_MS = 60_000

/** Process-control primitives, injectable so the Windows branch runs on every platform's tests. */
export interface ProcessControl {
  readonly platform: NodeJS.Platform
  readonly spawn: typeof spawn
  readonly kill: (pid: number, signal: NodeJS.Signals) => void
}

export const NODE_PROCESS_CONTROL: ProcessControl = {
  platform: process.platform,
  spawn,
  kill: (pid, signal) => { process.kill(pid, signal) },
}

/** POSIX tree termination signals the child's own process group, so it must lead one. Windows keeps its console. */
export function terminationSpawnOptions(
  policy: ProcessTermination,
  control: ProcessControl = NODE_PROCESS_CONTROL,
): { readonly detached: boolean } {
  return { detached: policy.tree && control.platform !== "win32" }
}

/** Stops `child` per `policy`; `exited` must settle when the child closes and may already have settled. */
export async function terminateChildProcess(
  child: ChildProcess,
  exited: Promise<unknown>,
  policy: ProcessTermination,
  control: ProcessControl = NODE_PROCESS_CONTROL,
): Promise<void> {
  if (policy.escalation === "immediate") {
    signalChildProcess(child, "SIGKILL", policy.tree, control)
    await exited
    return
  }
  if (policy.exitsOnStdinClose && (await waitForExit(exited, policy.stepTimeoutMs))) return
  signalChildProcess(child, "SIGTERM", policy.tree, control)
  if (await waitForExit(exited, policy.stepTimeoutMs)) return
  signalChildProcess(child, "SIGKILL", policy.tree, control)
  if (await waitForExit(exited, policy.stepTimeoutMs)) return
  const steps = policy.exitsOnStdinClose ? "stdin close, SIGTERM, and SIGKILL" : "SIGTERM and SIGKILL"
  throw new Error(`${policy.processName} did not exit after ${steps}`)
}

/** Longest delay a Node timer honours; anything larger fires after 1 ms. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** `setTimeout` turns zero, negative, non-finite and oversized delays into an almost immediate expiry. */
export function requirePositiveTimeout(value: number | undefined, label: string): void {
  if (value === undefined) return
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`CodeM ${label} timeout must be positive: ${String(value)}`)
  }
  if (value > MAX_TIMER_DELAY_MS) {
    throw new Error(`CodeM ${label} timeout must not exceed ${MAX_TIMER_DELAY_MS}ms: ${String(value)}`)
  }
}

function signalChildProcess(
  child: ChildProcess,
  signal: "SIGTERM" | "SIGKILL",
  tree: boolean,
  control: ProcessControl,
): void {
  if (!tree) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    return
  }
  // Tree members can outlive the direct child, so its exit does not skip the signal.
  const pid = child.pid
  if (!pid) return
  if (control.platform === "win32") {
    // taskkill owns this child tree only; no process-name or window-wide cleanup.
    const killer = control.spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true })
    killer.on("error", () => { child.kill("SIGKILL") })
    return
  }
  try {
    control.kill(-pid, signal)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal)
  }
}

async function waitForExit(exited: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
