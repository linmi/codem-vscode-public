import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { it, type TestContext } from "node:test"
import { checkTrackedIgnoredFiles, trackedIgnoredFiles } from "./workspaceHygieneChecks.ts"

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
