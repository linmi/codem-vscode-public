import { parseCodemPermissionMode, type CodemModeState, type CodemPermissionMode } from "@codem/protocol"

/** Host-facing alias of the shared CodeM mode DTO. Raw-frame parsing stays here. */
export type AppServerPermissionMode = CodemPermissionMode
export type AppServerModeState = CodemModeState

export function permissionMode(value: unknown): AppServerPermissionMode {
  return parseCodemPermissionMode(value)
}

export function parseAppServerModes(value: unknown, threadId: string): AppServerModeState {
  const result = record(value, "mode response", ["threadId", "state"])
  if (result.threadId !== threadId) throw new Error(`CodeM mode response thread mismatch: expected ${threadId}`)
  const state = record(result.state, "mode state", ["revision", "permissionEpoch", "permissionMode", "workMode"])
  if (!Number.isSafeInteger(state.revision) || (state.revision as number) < 0)
    throw new Error("Invalid CodeM mode revision")
  if (!Number.isSafeInteger(state.permissionEpoch) || (state.permissionEpoch as number) < 0)
    throw new Error("Invalid CodeM permission epoch")
  if (state.workMode !== "normal" && state.workMode !== "plan") throw new Error("Invalid CodeM work mode")
  return {
    revision: state.revision as number,
    permissionEpoch: state.permissionEpoch as number,
    permissionMode: permissionMode(state.permissionMode),
    workMode: state.workMode,
  }
}

export function reconcileAppServerModes(
  previous: AppServerModeState | null,
  next: AppServerModeState,
): AppServerModeState {
  if (!previous) return next
  if (next.revision < previous.revision) return previous
  if (next.revision === previous.revision) {
    if (
      next.permissionMode !== previous.permissionMode ||
      next.workMode !== previous.workMode ||
      next.permissionEpoch !== previous.permissionEpoch
    )
      throw new Error("CodeM mode revision has conflicting state")
    return previous
  }
  if (next.permissionEpoch < previous.permissionEpoch) throw new Error("CodeM permission epoch moved backwards")
  return next
}

function record(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error(`Invalid CodeM ${label}`)
  return value as Record<string, unknown>
}
