import { basename, dirname, join } from "node:path"

export interface WorktreeEntry { path: string; branch: string | null; head: string | null; detached: boolean; bare: boolean; locked: boolean; prunable: boolean }

/** Runs git in a directory and resolves stdout; rejects with git's stderr as the message. */
export type GitRunner = (args: readonly string[], cwd: string, signal?: AbortSignal) => Promise<string>

/** `git worktree list --porcelain`: records separated by blank lines, the main worktree first. */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  for (const block of output.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    const lines = block.split("\n").filter(Boolean)
    const path = lines.find(line => line.startsWith("worktree "))?.slice("worktree ".length)
    if (!path) continue
    const value = (key: string) => lines.find(line => line === key || line.startsWith(`${key} `))
    const branch = value("branch")?.slice("branch ".length) ?? null
    entries.push({
      path,
      branch: branch?.startsWith("refs/heads/") ? branch.slice("refs/heads/".length) : branch,
      head: value("HEAD")?.slice("HEAD ".length) ?? null,
      detached: value("detached") !== undefined,
      bare: value("bare") !== undefined,
      locked: value("locked") !== undefined,
      prunable: value("prunable") !== undefined,
    })
  }
  return entries
}

/** A readable branch name from free text; git itself has the final say through check-ref-format. */
export function suggestedBranch(input: string): string {
  return input.trim()
    .replace(/[\s~^:?*[\\\]]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/@\{/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/(^[-./]+)|([-./]+$)/g, "")
    .replace(/\.lock(?=\/|$)/g, "-lock")
    .slice(0, 100)
}

/** Worktrees live beside the main checkout (`<parent>/<repo>.worktrees/<branch>`), never inside it, so they add nothing to its watchers, search or status. */
export function worktreeLocation(mainWorktree: string, branch: string): string {
  return join(dirname(mainWorktree), `${basename(mainWorktree)}.worktrees`, branch.replace(/\//g, "-"))
}

/**
 * The line of git's stderr that says what went wrong: the first `error:` or `fatal:` line, else the last line that
 * is not a `hint:`. Hints come last and would otherwise replace the reason.
 */
export function gitErrorMessage(stderr: string): string | null {
  const lines = stderr.replace(/\r\n/g, "\n").split("\n").map(line => line.trim()).filter(Boolean)
  const reason = lines.find(line => /^(error|fatal):/.test(line)) ?? lines.filter(line => !line.startsWith("hint:")).at(-1)
  return reason?.replace(/^(error|fatal):\s*/, "") ?? null
}

/**
 * `target` spelled the way this window's folder was opened. Git reports real paths, so a checkout opened through a
 * symlink (macOS `/tmp` → `/private/tmp`) would otherwise open a second window instead of focusing the existing one.
 */
export function asOpenedPath(target: string, opened: string, openedReal: string, separator = "/"): string {
  const a = opened.split(separator), b = openedReal.split(separator)
  let shared = 0
  while (shared < a.length && shared < b.length && a[a.length - 1 - shared] === b[b.length - 1 - shared]) shared++
  const openedPrefix = a.slice(0, a.length - shared).join(separator)
  const realPrefix = b.slice(0, b.length - shared).join(separator)
  if (openedPrefix === realPrefix || !realPrefix || !target.startsWith(realPrefix + separator)) return target
  return openedPrefix + target.slice(realPrefix.length)
}

export class Worktrees {
  private readonly git: GitRunner
  constructor(git: GitRunner) { this.git = git }

  async list(repository: string, signal?: AbortSignal): Promise<WorktreeEntry[]> {
    return parseWorktreeList(await this.git(["worktree", "list", "--porcelain"], repository, signal))
  }

  /** Throws git's own reason when the name is not a valid branch. */
  async assertBranchName(repository: string, branch: string, signal?: AbortSignal): Promise<void> {
    if (!branch || branch.startsWith("-")) throw new Error("分支名无效。")
    try { await this.git(["check-ref-format", "--branch", branch], repository, signal) }
    catch { throw new Error(`「${branch}」不是有效的分支名。`) }
  }

  async branchExists(repository: string, branch: string, signal?: AbortSignal): Promise<boolean> {
    try { await this.git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repository, signal); return true }
    catch { return false }
  }

  /**
   * Creates the worktree for `branch` beside the main checkout. A new branch starts from `base`; an existing
   * branch that no worktree has checked out is reused as is. Returns the new worktree's path.
   */
  async create(repository: string, branch: string, base: string, signal?: AbortSignal): Promise<string> {
    await this.assertBranchName(repository, branch, signal)
    const worktrees = await this.list(repository, signal)
    const main = worktrees[0]
    if (!main || main.bare) throw new Error("无法确定主工作区，暂不支持裸仓库。")
    const taken = worktrees.find(entry => entry.branch === branch)
    if (taken) throw new Error(`分支 ${branch} 已在 ${taken.path} 检出，可以直接打开该 worktree。`)
    const path = worktreeLocation(main.path, branch)
    if (worktrees.some(entry => entry.path === path)) throw new Error(`${path} 已是一个 worktree。`)
    const exists = await this.branchExists(repository, branch, signal)
    await this.git(exists ? ["worktree", "add", "--", path, branch] : ["worktree", "add", "-b", branch, "--", path, base], repository, signal)
    return path
  }
}
