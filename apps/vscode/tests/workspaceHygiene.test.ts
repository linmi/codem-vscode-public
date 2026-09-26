import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { it, type TestContext } from "node:test"
import { catalogNames, catalogViolations, checkCatalogDependencies, checkTrackedIgnoredFiles, trackedIgnoredFiles } from "./workspaceHygieneChecks.ts"

const workspace = fileURLToPath(new URL("../../..", import.meta.url))
const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))

async function put(root: string, path: string, content = ""): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

async function repository(t: TestContext, files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codem-workspace-hygiene-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  execFileSync("git", ["init", "-q"], { cwd: root, env: gitEnvironment })
  for (const [path, content] of Object.entries(files)) await put(root, path, content)
  execFileSync("git", ["add", "-A"], { cwd: root, env: gitEnvironment })
  return root
}

it("tracked ignored files gate: the workspace tracks nothing its .gitignore excludes", () => {
  checkTrackedIgnoredFiles(workspace)
})

it("tracked ignored files gate: accepts ignored files that stay untracked and negated exceptions", async t => {
  const root = await repository(t, {
    ".gitignore": "output/\n.vscode/*\n!.vscode/settings.json\n",
    "README.md": "",
    ".vscode/settings.json": "{}",
  })
  await put(root, "output/snapshot.json", "{}")
  await put(root, ".vscode/extensions.json", "{}")
  assert.deepEqual(trackedIgnoredFiles(root), [])
})

it("tracked ignored files gate: rejects a file force-added under an ignored directory", async t => {
  const root = await repository(t, { ".gitignore": "output/\n", "README.md": "" })
  await put(root, "output/codemIntro/draft.json", "{}")
  execFileSync("git", ["add", "-f", "output/codemIntro/draft.json"], { cwd: root, env: gitEnvironment })
  assert.deepEqual(trackedIgnoredFiles(root), ["output/codemIntro/draft.json"])
  assert.throws(() => checkTrackedIgnoredFiles(root), /output\/codemIntro\/draft\.json/)
})

it("tracked ignored files gate: rejects a tracked file once a new ignore rule covers it", async t => {
  const root = await repository(t, { ".gitignore": "dist/\n", "output/snapshot.json": "{}" })
  await put(root, ".gitignore", "dist/\noutput/\n")
  assert.deepEqual(trackedIgnoredFiles(root), ["output/snapshot.json"])
})

const WORKSPACE_YAML = `packages:
  - "apps/*"
  - "packages/*"

catalog:
  react: 19.3.0
  "@types/react": 19.3.0
  'tw-animate-css': 1.4.0
  typescript: 7.0.2 # pinned

allowBuilds:
  esbuild: true
`

function manifest(fields: Record<string, Record<string, string>>): string {
  return JSON.stringify({ name: "fixture", private: true, ...fields })
}

it("catalog gate: shared dependency versions in the workspace come from the pnpm catalog", () => {
  checkCatalogDependencies(workspace)
})

it("catalog gate: reads plain, double- and single-quoted catalog names and stops at the next top-level key", async t => {
  const root = await repository(t, { "pnpm-workspace.yaml": WORKSPACE_YAML })
  assert.deepEqual([...catalogNames(root)].sort(), ["@types/react", "react", "tw-animate-css", "typescript"])
})

it("catalog gate: accepts catalog references, workspace links and dependencies only one package declares", async t => {
  const root = await repository(t, {
    "pnpm-workspace.yaml": WORKSPACE_YAML,
    "package.json": manifest({ devDependencies: { oxlint: "1.83.0" } }),
    "apps/vscode/package.json": manifest({ dependencies: { "@codem/ui": "workspace:*", react: "catalog:", "get-nonce": "1.0.1" }, devDependencies: { typescript: "catalog:" } }),
    "packages/ui/package.json": manifest({ dependencies: { "@codem/protocol": "workspace:*", react: "catalog:" }, devDependencies: { "tw-animate-css": "catalog:" } }),
    "packages/protocol/package.json": manifest({ devDependencies: { typescript: "catalog:" } }),
  })
  assert.deepEqual(catalogViolations(root), [])
})

it("catalog gate: rejects a pinned version of a catalog entry in any dependency field", async t => {
  const root = await repository(t, {
    "pnpm-workspace.yaml": WORKSPACE_YAML,
    "apps/vscode/package.json": manifest({ dependencies: { react: "19.3.0" }, devDependencies: { "@types/react": "^19.3.0" } }),
    "packages/ui/package.json": manifest({ peerDependencies: { "tw-animate-css": "1.4.0" } }),
  })
  assert.deepEqual(catalogViolations(root), [
    'apps/vscode/package.json dependencies.react is "19.3.0"; use "catalog:"',
    'apps/vscode/package.json devDependencies.@types/react is "^19.3.0"; use "catalog:"',
    'packages/ui/package.json peerDependencies.tw-animate-css is "1.4.0"; use "catalog:"',
  ])
  assert.throws(() => checkCatalogDependencies(root), /use "catalog:"/)
})

it("catalog gate: rejects an external dependency two packages declare outside the catalog, even at the same version", async t => {
  const root = await repository(t, {
    "pnpm-workspace.yaml": WORKSPACE_YAML,
    "apps/vscode/package.json": manifest({ dependencies: { cmdk: "1.1.1" } }),
    "packages/ui/package.json": manifest({ devDependencies: { cmdk: "1.1.1" } }),
  })
  assert.deepEqual(catalogViolations(root), ["cmdk is declared by apps/vscode/package.json, packages/ui/package.json; add it to the pnpm catalog"])
})

it("catalog gate: refuses named catalogs instead of skipping them", async t => {
  const root = await repository(t, { "pnpm-workspace.yaml": `${WORKSPACE_YAML}catalogs:\n  react18:\n    react: 18.3.1\n` })
  assert.throws(() => catalogNames(root), /Named pnpm catalogs/)
})
