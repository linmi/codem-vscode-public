import type { ConversationTurn } from "./model.ts"

type ActiveConversationTurn = Extract<
  ConversationTurn,
  { readonly completedAt: null }
>
type TerminalConversationTurn = Extract<
  ConversationTurn,
  { readonly completedAt: string }
>

export type ConversationTurnLifecycle =
  | Pick<ActiveConversationTurn, 'state' | 'completedAt'>
  | Pick<TerminalConversationTurn, 'state' | 'completedAt'>

export function activeTurnLifecycle(
  state: ActiveConversationTurn['state'],
): Pick<ActiveConversationTurn, 'state' | 'completedAt'> {
  return { state, completedAt: null }
}

export function terminalTurnLifecycle(
  state: TerminalConversationTurn['state'],
  completedAt: string,
): Pick<TerminalConversationTurn, 'state' | 'completedAt'> {
  return { state, completedAt }
}
