import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { basename, join } from "node:path"

const CODE_FILE = /\.(?:[cm]?[jt]sx?|kts?)$/

/**
 * Directories that keep their upstream file names on purpose. `packages/history/src/shared/` is a
 * selective copy of the CodeM Desktop reducer (`main@d7763f0a`, recorded in UPSTREAM.md); keeping the
 * upstream names lets later imports be compared file by file, so the copy is not renamed.
 */
export const UPSTREAM_NAMING_EXCEPTIONS = ["packages/history/src/shared/"] as const

/** Source code files under apps/ and packages/ whose name (before the first dot) uses the `xx-xx` form. */
export function kebabCaseCodeFiles(root: string): string[] {
  // Git decides what counts as source: tracked files plus new files that .gitignore does not exclude,
  // so node_modules and build output never reach the check.
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "apps", "packages"], {
    cwd: root,
    encoding: "utf8",
    env: withoutGitOverrides(),
  })
  return [...new Set(listed.split("\0"))]
    .filter(path => CODE_FILE.test(path) && basename(path).split(".")[0]!.includes("-"))
    .filter(path => !UPSTREAM_NAMING_EXCEPTIONS.some(directory => path.startsWith(directory)))
    // A file removed from disk but not yet from the index is not a naming problem.
    .filter(path => existsSync(join(root, path)))
    .sort()
}

export function checkCodeFileNames(root: string): void {
  const offenders = kebabCaseCodeFiles(root)
  if (offenders.length) {
    throw new Error(`Code files use camelCase (PascalCase for a type), never xx-xx; rename:\n${offenders.join("\n")}`)
  }
}

/** Git hooks export GIT_DIR and GIT_INDEX_FILE, which would point the listing at another repository. */
function withoutGitOverrides(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
}
