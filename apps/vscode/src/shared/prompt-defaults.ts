import type { AppServerPermissionMode } from "@codem/app-server/modes"

export interface PromptDefaults {
  readonly intelligence: string
  readonly permissionMode: AppServerPermissionMode
}

/** Product defaults, also declared by the codem.* configuration manifest. */
export const DEFAULT_PROMPT_SETTINGS: PromptDefaults = {
  intelligence: "medium",
  permissionMode: "auto",
}
