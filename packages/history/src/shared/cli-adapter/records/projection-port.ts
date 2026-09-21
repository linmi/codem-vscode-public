import type {
  AgentDurableTurnStopReason,
  ConversationItem,
  ConversationTurn,
  ConversationUsage,
} from "../../session/index.ts"
import type { BackgroundItemRevisionUpdate } from "./background/model.ts"

export interface CodeMEngineTurnSource {
  readonly turnIndex: number
  readonly requestLine: number
  readonly endLine: number | null
  readonly stopReason: AgentDurableTurnStopReason | null
  readonly lifecycle: 'open' | 'ended'
}

export type CodeMTurnInitialSubmission =
  | { readonly source: 'legacy-user-message' }
  | {
      readonly source: 'user-invocation'
      readonly inputKind: 'message' | 'skill'
      readonly submissionId: string | null
    }

export interface CodeMConversationTurnProjectionInput {
  readonly sessionId: string
  readonly turnId: string
  readonly index: number
  readonly initialSubmission: CodeMTurnInitialSubmission
  readonly engineTurns: readonly CodeMEngineTurnSource[]
  readonly engineTurnIndexes: readonly number[]
  readonly items: readonly ConversationItem[]
  readonly model: string | null
  readonly provider: string | null
  readonly startedAt: string
  readonly state: ConversationTurn['state']
  readonly completedAt: string | null
  readonly usage: ConversationUsage | null
  readonly terminal: boolean
}

/**
 * Optional projection hook used by Main's incremental SQLite projection.
 * The adapter owns CodeM record interpretation; the consumer owns every
 * projection-specific state, correlation, delta, payload and revision type.
 */
export interface CodeMConversationProjectionPort<State, Delta, Revision> {
  readonly initialState: () => State
  readonly projectTurn: (
    input: CodeMConversationTurnProjectionInput,
    state: State,
  ) => { readonly delta: Delta; readonly state: State }
  readonly reviseTurn: (
    projectionTurnId: string,
    itemIndex: number,
    update: BackgroundItemRevisionUpdate,
  ) => Revision
}
