import { spawn, type ChildProcess } from "node:child_process"

export interface InhibitorCommand { command: string; args: readonly string[] }
export type KeepAwakePhase = "off" | "starting" | "on"

/**
 * The OS inhibitor for one platform, or null where none is supported. Each one ends by itself when `hostPid`
 * exits, so a crashed extension host can never leave the machine unable to sleep.
 */
export function inhibitorCommand(platform: NodeJS.Platform, hostPid: number): InhibitorCommand | null {
  const pid = String(hostPid)
  switch (platform) {
    case "darwin":
      // -i blocks idle sleep only; the display may still turn off. -w exits with the host.
      return { command: "caffeinate", args: ["-i", "-w", pid] }
    case "linux":
      return { command: "systemd-inhibit", args: ["--what=idle:sleep", "--who=CodeM", "--why=CodeM 防休眠已开启", "--mode=block", "tail", `--pid=${pid}`, "-f", "/dev/null"] }
    case "win32": {
      // ES_CONTINUOUS | ES_SYSTEM_REQUIRED holds until this thread exits, which Wait-Process ties to the host.
      const script = `Add-Type -Namespace CodeM -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'; if ([CodeM.Power]::SetThreadExecutionState([uint32]"0x80000001") -eq 0) { exit 3 }; Wait-Process -Id ${pid}`
      return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script] }
    }
    default:
      return null
  }
}

export interface KeepAwakeOptions {
  command: InhibitorCommand | null
  /** Receives every phase change, including the one after an unexpected exit. */
  publish(phase: KeepAwakePhase): void
  /** Reports an inhibitor that could not start or stopped on its own; the phase is already `off`. */
  failed(message: string): void
  spawn?: (command: string, args: readonly string[]) => ChildProcess
}

/**
 * Owns the one inhibitor process of this extension host. The state lives only in memory: reloading the window
 * or disabling the extension ends the process and starts with keep-awake off.
 */
export class KeepAwake {
  private child: ChildProcess | null = null
  private phase: KeepAwakePhase = "off"
  private readonly options: KeepAwakeOptions
  private readonly start: (command: string, args: readonly string[]) => ChildProcess

  constructor(options: KeepAwakeOptions) {
    this.options = options
    this.start = options.spawn ?? ((command, args) => spawn(command, args, { stdio: "ignore", windowsHide: true }))
  }

  get state(): KeepAwakePhase { return this.phase }
  get supported(): boolean { return this.options.command !== null }

  toggle(): void {
    if (this.phase === "off") this.enable()
    else this.disable()
  }

  enable(): void {
    if (this.phase !== "off") return
    const command = this.options.command
    if (!command) { this.options.failed("当前系统不支持防休眠。"); return }
    let child: ChildProcess
    try { child = this.start(command.command, command.args) }
    catch (error) { this.options.failed(startFailure(command, error)); return }
    this.child = child
    this.set("starting")
    child.once("spawn", () => { if (this.child === child) this.set("on") })
    child.once("error", error => this.lost(child, startFailure(command, error)))
    child.once("exit", code => this.lost(child, code === 0 || code === null ? "防休眠已意外停止。" : `防休眠已停止：${command.command} 退出码 ${code}。`))
  }

  disable(): void {
    const child = this.child
    if (!child) return
    this.child = null
    child.kill()
    this.set("off")
  }

  dispose(): void { this.disable() }

  /** Only the current child may report; a stale exit after disable or a restart changes nothing. */
  private lost(child: ChildProcess, message: string): void {
    if (this.child !== child) return
    this.child = null
    this.set("off")
    this.options.failed(message)
  }

  private set(phase: KeepAwakePhase): void {
    if (this.phase === phase) return
    this.phase = phase
    this.options.publish(phase)
  }
}

function startFailure(command: InhibitorCommand, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === "ENOENT") return `无法开启防休眠：未找到 ${command.command}。`
  return `无法开启防休眠：${error instanceof Error ? error.message : String(error)}`
}
