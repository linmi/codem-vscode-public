/**
 * Shared fail-closed copy for surfaces that still assume Kilo REST/SSE.
 * Production must not start `kilo serve`; unmigrated callers show this text.
 */
export const KILO_TRANSPORT_RETIRED_MESSAGE = "尚未迁移到 CodeM App Server"

export function kiloTransportRetiredError(detail?: string): Error {
  return new Error(detail ? `${KILO_TRANSPORT_RETIRED_MESSAGE}: ${detail}` : KILO_TRANSPORT_RETIRED_MESSAGE)
}
