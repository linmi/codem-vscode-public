import { sessionFileError } from "./jsonl.ts"
import { requireNonEmptyString } from "./fields.ts"
import type { AgentDurableTurnStopReason } from "../../session/index.ts"

/**
 * The single wire-level decode of a persisted `turn_end.stop_reason`. It keeps
 * the `MaxTokens` vs data-carrying `Other` distinction intact so the visible
 * turn lifecycle can align with TUI while durable engine-turn metadata retains
 * the exact stop reason. There is no second wire decoder.
 */
export type PersistedTurnStopReason =
  | { readonly kind: 'tool-use' }
  | { readonly kind: 'end-turn' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'max-tokens' }
  | { readonly kind: 'other'; readonly reason: string }

type CanonicalTurnStopReason =
  | { readonly kind: 'tool-use' }
  | { readonly kind: 'end-turn' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'max-tokens' }
  | {
      readonly kind: 'failed'
      readonly cause: 'runtime'
      readonly reason: string
    }

/**
 * Converts historical persisted stop-reason encodings at the JSONL boundary.
 * Older CodeM runtimes serialized the data-carrying Rust `Other` enum variant
 * as `{ "Other": "..." }`; this preserves the original failure reason.
 */
export function decodePersistedTurnStopReason(
  value: unknown,
  path: string,
  lineNumber: number,
): PersistedTurnStopReason {
  if (value === 'ToolUse') return { kind: 'tool-use' }
  if (value === 'EndTurn') return { kind: 'end-turn' }
  if (value === 'Cancelled') return { kind: 'cancelled' }
  if (value === 'MaxTokens') return { kind: 'max-tokens' }

  if (isLegacyOtherStopReason(value)) {
    return {
      kind: 'other',
      reason: requireNonEmptyString(
        value.Other,
        path,
        lineNumber,
        'stop_reason.Other',
      ),
    }
  }

  throw sessionFileError(
    path,
    lineNumber,
    `unsupported turn stop_reason ${persistedValueDescription(value)}`,
  )
}

// Visible turn lifecycle mapping: TUI treats ordinary MaxTokens as a normal
// terminal boundary with the partial assistant output preserved. The exact
// cause remains on the engine-turn metadata for diagnostics and audit.
export function canonicalTurnStopReason(
  reason: PersistedTurnStopReason,
): CanonicalTurnStopReason {
  switch (reason.kind) {
    case 'tool-use':
      return { kind: 'tool-use' }
    case 'end-turn':
      return { kind: 'end-turn' }
    case 'cancelled':
      return { kind: 'cancelled' }
    case 'max-tokens':
      return { kind: 'max-tokens' }
    case 'other':
      return { kind: 'failed', cause: 'runtime', reason: reason.reason }
  }
}

// Durable-turn watermark mapping consumed by the live engine / coordinator.
export function durableTurnStopReason(
  reason: PersistedTurnStopReason,
): AgentDurableTurnStopReason {
  switch (reason.kind) {
    case 'tool-use':
      return 'tool_use'
    case 'end-turn':
      return 'end_turn'
    case 'cancelled':
      return 'cancelled'
    case 'max-tokens':
      return 'max_tokens'
    case 'other':
      return 'other'
  }
}

function isLegacyOtherStopReason(
  value: unknown,
): value is { readonly Other: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === 'Other'
}

function persistedValueDescription(value: unknown): string {
  if (typeof value === 'string') return value
  const encoded = JSON.stringify(value)
  return encoded === undefined ? String(value) : encoded
}
