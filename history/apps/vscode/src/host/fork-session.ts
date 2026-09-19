import type { Session, SessionStatus } from "@codem/ui/types/session"
import type { KiloConnectionService } from "../services/cli-backend"

export interface ForkContext {
  connection: KiloConnectionService
  post: (message: { type: "error"; message: string }) => void
  register: (session: Session) => void
  forked: (session: Session, sourceID: string) => void
  status: (sessionID: string) => SessionStatus["type"] | undefined
  directory: (sessionID: string) => string
}

export async function handleForkSession(
  ctx: ForkContext,
  _sessionId: string,
  _messageId?: string,
): Promise<void> {
  ctx.post({ type: "error", message: "尚未迁移到 CodeM App Server: forkSession" })
}
