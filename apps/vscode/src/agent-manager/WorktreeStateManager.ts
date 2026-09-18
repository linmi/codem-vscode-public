export interface Worktree {
  id: string
  branch: string
  path: string
  parentBranch: string
  remote?: string
  createdAt: string
  groupId?: string
  label?: string
  prNumber?: number
  prUrl?: string
  prState?: string
  originalBranch?: string
  branchOwned?: boolean
  autoNameSessionId?: string
  autoNamePromptCount?: number
  sectionId?: string
}

export interface Section {
  id: string
  name: string
  color: string | null
  order: number
  collapsed: boolean
}

export function remoteRef(wt: Pick<Worktree, "parentBranch" | "remote">): string {
  return wt.remote ? `${wt.remote}/${wt.parentBranch}` : wt.parentBranch
}

export interface ManagedSession {
  id: string
  worktreeId: string | null
  createdAt: string
}
