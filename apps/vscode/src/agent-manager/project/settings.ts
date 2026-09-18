import type { BranchListItem } from "../git-import"

export interface SettingsProject {
  id: string
  root: string
  label: string
  pinned: boolean
  missing: boolean
  defaultBaseBranch?: string
  defaultBranch?: string
  setupScriptPath?: string
}

export interface SettingsBranches {
  projectId: string
  branches: BranchListItem[]
  defaultBranch: string
  configuredBaseBranch?: string
  setupScriptPath?: string
}

export interface SettingsHandler {
  projects(projectId?: string): Promise<SettingsProject[]>
  projectDirectory(projectId: string): string | undefined
  defaultBranch(projectId: string): Promise<string | undefined>
  branches(projectId: string): Promise<SettingsBranches | undefined>
  setDefaultBaseBranch(projectId: string, branch?: string): Promise<void>
  configureSetupScript(projectId: string): Promise<void>
}

/** Empty handler: leftover worktree/project registry is retired. Settings UI still mounts. */
export function createSettingsHandler(): SettingsHandler {
  return {
    projects: async () => [],
    projectDirectory: () => undefined,
    defaultBranch: async () => undefined,
    branches: async () => undefined,
    setDefaultBaseBranch: async () => {},
    configureSetupScript: async () => {},
  }
}
