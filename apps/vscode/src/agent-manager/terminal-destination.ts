export type TerminalDestination = "vscode" | "agentManager"

export function resolveTerminalDestination(value: unknown): TerminalDestination {
  return value === undefined || value === "agentManager" ? "agentManager" : "vscode"
}
