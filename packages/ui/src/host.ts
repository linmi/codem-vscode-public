/**
 * 窄宿主接口。主机只提供快照、动作、主题。
 * 不注入整个 Host/Controller，也不伪造 acquireVsCodeApi。
 */
/** Host 主动改草稿时使用。用户自己的输入不走这条通道。 */
export interface HostDraftCommand {
  revision: number
  text: string
  mode: "message" | "askSideQuestion" | "steer" | "shellCommand"
  focus: boolean
  pendingRequestId: string | null
}

export interface CodemUiHost {
  postAction(action: Record<string, unknown>): void
  subscribe(listener: (message: Record<string, unknown>) => void): () => void
  subscribeDraft?(listener: (command: HostDraftCommand) => void): () => void
  getState(): Record<string, unknown> | null
  setState(state: Record<string, unknown>): void
  /** editor 才有历史、新建和日志；sidebar 与旧版侧栏一致。 */
  surface?: "sidebar" | "editor"
}

export interface MountHandle {
  dispose(): void
}
