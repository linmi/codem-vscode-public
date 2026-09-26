import { execFileSync } from "node:child_process"

/** Tracked files that .gitignore excludes: scratch output or build products committed before the rule existed, or with `git add -f`. */
export function trackedIgnoredFiles(root: string): string[] {
  const listed = execFileSync("git", ["ls-files", "--cached", "--ignored", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    env: withoutGitOverrides(),
  })
  return listed.split("\0").filter(Boolean).sort()
}

export function checkTrackedIgnoredFiles(root: string): void {
  const offenders = trackedIgnoredFiles(root)
  if (offenders.length) {
    throw new Error(`Ignored paths must not be tracked; remove them with git rm --cached or narrow .gitignore:\n${offenders.join("\n")}`)
  }
}

/** Git hooks export GIT_DIR and GIT_INDEX_FILE, which would point the listing at another repository. */
function withoutGitOverrides(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
}
