export type AgentDurableTurnStopReason =
  | 'tool_use'
  | 'end_turn'
  | 'cancelled'
  | 'max_tokens'
  | 'other'
