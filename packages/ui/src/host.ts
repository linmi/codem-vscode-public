/**
 * 窄宿主接口。主机只提供快照、动作、主题。
 * 不注入整个 Host/Controller，也不伪造 acquireVsCodeApi。
 */
export interface CodemUiHost {
  postAction(action: Record<string, unknown>): void
  subscribe(listener: (message: Record<string, unknown>) => void): () => void
  getState(): Record<string, unknown> | null
  setState(state: Record<string, unknown>): void
}

export interface MountHandle {
  dispose(): void
}
