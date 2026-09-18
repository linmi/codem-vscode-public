export type RunState = "idle" | "running" | "stopping"

export interface RunStatus {
  worktreeId: string
  state: RunState
  exitCode?: number
  stopped?: boolean
  signal?: string
  startedAt?: string
  finishedAt?: string
  error?: string
}
