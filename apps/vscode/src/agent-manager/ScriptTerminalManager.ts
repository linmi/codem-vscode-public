import type { TerminalFont } from "./terminal-font"

export type ScriptTerminalKind = "run" | "setup"
type ScriptTerminalState = "running" | "stopping" | "exited" | "failed"

export interface ScriptTerminalView {
  terminalId: string
  projectId?: string
  worktreeId: string | null
  kind: ScriptTerminalKind
  title: "Run" | "Setup"
  wsUrl: string
  state: ScriptTerminalState
  exitCode?: number
  font: TerminalFont
}
