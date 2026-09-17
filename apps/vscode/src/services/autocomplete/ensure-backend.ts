import type { KiloConnectionService } from "../cli-backend"

/**
 * Autocomplete must not start `kilo serve`. The Kilo REST/SSE transport is retired.
 */
export function ensureBackendForAutocomplete(_connection: KiloConnectionService): void {
  return
}
