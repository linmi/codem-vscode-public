import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const

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

/**
 * Names in the default `catalog:` block of pnpm-workspace.yaml. Only the flat `name: version` form the
 * workspace uses is read; a named `catalogs:` block is rejected rather than silently skipped.
 */
export function catalogNames(root: string): Set<string> {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split(/\r?\n/)
  if (lines.some(line => line.startsWith("catalogs:"))) throw new Error("Named pnpm catalogs are not supported by the catalog gate")
  const names = new Set<string>()
  let inCatalog = false
  for (const line of lines) {
    if (/^\S/.test(line)) inCatalog = /^catalog:\s*$/.test(line)
    else if (inCatalog) {
      const entry = /^\s+(?:"([^"]+)"|'([^']+)'|([^\s:#"']+)):/.exec(line)
      if (entry) names.add(entry[1] ?? entry[2] ?? entry[3]!)
    }
  }
  return names
}

/**
 * Shared dependency versions live in the pnpm catalog: a package that declares a catalog entry must
 * use `catalog:`, and an external dependency declared by two or more workspace packages must be in the
 * catalog. Workspace links and `catalog:` references are what the rule asks for, so they never count.
 */
export function catalogViolations(root: string): string[] {
  const catalog = catalogNames(root)
  const manifests = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "package.json", "apps/*/package.json", "packages/*/package.json"], {
    cwd: root,
    encoding: "utf8",
    env: withoutGitOverrides(),
  }).split("\0").filter(Boolean).sort()
  const declaredBy = new Map<string, string[]>()
  const violations: string[] = []
  for (const manifest of manifests) {
    const content = JSON.parse(readFileSync(join(root, manifest), "utf8")) as Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>>
    const names = new Set<string>()
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, specifier] of Object.entries(content[field] ?? {})) {
        if (specifier.startsWith("workspace:")) continue
        if (catalog.has(name) && specifier !== "catalog:") violations.push(`${manifest} ${field}.${name} is "${specifier}"; use "catalog:"`)
        if (specifier !== "catalog:") names.add(name)
      }
    }
    for (const name of names) declaredBy.set(name, [...(declaredBy.get(name) ?? []), manifest])
  }
  for (const [name, packages] of declaredBy) {
    if (packages.length > 1 && !catalog.has(name)) violations.push(`${name} is declared by ${packages.join(", ")}; add it to the pnpm catalog`)
  }
  return violations.sort()
}

export function checkCatalogDependencies(root: string): void {
  const violations = catalogViolations(root)
  if (violations.length) throw new Error(`Shared dependency versions belong in the pnpm catalog:\n${violations.join("\n")}`)
}

/** Git hooks export GIT_DIR and GIT_INDEX_FILE, which would point the listing at another repository. */
function withoutGitOverrides(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))
}
