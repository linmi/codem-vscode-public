import type { CodemPermissionMode } from "@codem/protocol"

export interface PromptDefaults {
  readonly intelligence: string
  readonly permissionMode: CodemPermissionMode
}

/** Product defaults, also declared by the codem.* configuration manifest. */
export const DEFAULT_PROMPT_SETTINGS: PromptDefaults = {
  intelligence: "medium",
  permissionMode: "auto",
}
