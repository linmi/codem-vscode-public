/**
 * `@codem/protocol` public surface (physical path: packages/protocol).
 * Catalog + thread-mode DTOs only. Do not add leftover OpenCode HttpApi or App Server Host APIs.
 * Shapes are handwritten and aligned with this repo's CodeM App Server catalog/mode DTO.
 * Do not import leftover SDK packages, Node, VS Code, Electron, or DOM APIs.
 */

/** Core permission modes that Webview may display or request. */
export type CodemPermissionMode = "default" | "auto" | "yolo"

/** Core work mode on a live thread. Distinct from Host thread-settings `default`/`plan`. */
export type CodemWorkMode = "normal" | "plan"

/** Thread-mode DTO posted on `threadModesChanged` / `threadModesResult`. */
export interface CodemModeState {
  readonly revision: number
  readonly permissionEpoch: number
  readonly permissionMode: CodemPermissionMode
  readonly workMode: CodemWorkMode
}

/**
 * Narrow an unknown picker value to a permission mode.
 * Isomorphic on purpose so Webview does not import `@codem/app-server`.
 */
export function parseCodemPermissionMode(value: unknown): CodemPermissionMode {
  if (value !== "default" && value !== "auto" && value !== "yolo") {
    throw new Error(`Invalid CodeM permissionMode: ${String(value)}`)
  }
  return value
}

/** Catalog row posted on `codemModelsLoaded`. No paths or secrets. */
export interface CodemModelSummary {
  readonly id: string
  readonly source: string
  readonly contextWindowTokens: number
  readonly supportsVision: boolean
}

/** Skill row posted on `codemSkillsLoaded`. Name and description only. */
export interface CodemSkillSummary {
  readonly name: string
  readonly description: string
}

/** Builtin reasoning-effort ids shown by the model picker. */
export const CODEM_BUILTIN_INTELLIGENCE_TIERS = ["low", "medium", "high", "xhigh"] as const

export type CodemBuiltinIntelligence = (typeof CODEM_BUILTIN_INTELLIGENCE_TIERS)[number]

export interface CodemModelCatalog {
  readonly activeModel: string
  readonly models: readonly CodemModelSummary[]
}
