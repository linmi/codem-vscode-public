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
  /** 各会话暂存的草稿，原样交回界面上次保存的值；界面自己校验。只在恢复或清空时携带。 */
  sessions?: unknown
}

export interface CodemUiHost {
  postAction(action: Record<string, unknown>): void
  subscribe(listener: (message: Record<string, unknown>) => void): () => void
  subscribeDraft?(listener: (command: HostDraftCommand) => void): () => void
  getState(): Record<string, unknown> | null
  /** 保存 draft（当前会话的草稿）和 sessions（各会话草稿），重载后由 getState 交回。 */
  setState(state: Record<string, unknown>): void
  /** editor 才有历史、新建和日志；sidebar 与旧版侧栏一致。 */
  surface?: "sidebar" | "editor"
}

export interface MountHandle {
  dispose(): void
}
