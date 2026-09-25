import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { it, type TestContext } from "node:test"
import { checkCodeFileNames, kebabCaseCodeFiles } from "./fileNamingChecks.ts"

const workspace = fileURLToPath(new URL("../../..", import.meta.url))
const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")))

async function put(root: string, path: string, content = ""): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

/** A git repository whose files are all tracked, except what its .gitignore excludes. */
async function repository(t: TestContext, files: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codem-file-naming-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  execFileSync("git", ["init", "-q"], { cwd: root, env: gitEnvironment })
  await put(root, ".gitignore", "node_modules/\ndist/\nbuild/\n")
  for (const file of files) await put(root, file)
  execFileSync("git", ["add", "-A"], { cwd: root, env: gitEnvironment })
  return root
}

it("file naming gate: active apps and packages use camelCase code file names", () => {
  checkCodeFileNames(workspace)
})

it("file naming gate: accepts camelCase and PascalCase code, dotted suffixes, non-code files, ignored output, the archive and the recorded upstream copy", async t => {
  const root = await repository(t, [
    "apps/vscode/src/chat/chatController.ts",
    "apps/vscode/tests/chatController.test.ts",
    "apps/vscode/tests/profileModules.d.ts",
    "apps/vscode/tests/accountPreviewChecks.mjs",
    "apps/docs/src/docs/docsApp.tsx",
    "apps/jetbrains/src/main/kotlin/com/codem/intellij/core/RpcPeer.kt",
    "apps/jetbrains/build.gradle.kts",
    "apps/jetbrains/gradle/wrapper/gradle-wrapper.properties",
    "apps/docs/src/assets/brand-mark.svg",
    "packages/contracts/history/bad-complete-line.jsonl",
    "packages/history/src/shared/session/final-answer.ts",
    "packages/history/src/shared/cli-adapter/records/turn/artifact-records.ts",
    "history/apps/vscode/src/old-name.ts",
    "apps/vscode/dist/extension-host.cjs",
    "apps/jetbrains/build/generated-sources.kt",
    "packages/ui/node_modules/some-package/index-file.js",
    "packages/app-server/src/stale-entry.ts",
  ])
  // Removed from disk, still in the index: the next commit drops it.
  await rm(join(root, "packages/app-server/src/stale-entry.ts"))
  assert.deepEqual(kebabCaseCodeFiles(root), [])
  checkCodeFileNames(root)
})

for (const file of [
  "packages/app-server/src/control-plane.ts",
  "packages/app-server/tests/protocol-alias.test.ts",
  "packages/ui/src/chat/chat-view.tsx",
  "apps/vscode/tests/preview-checks.mjs",
  "apps/docs/scripts/build-site.js",
  "apps/vscode/scripts/support/entry-list.cjs",
  "apps/vscode/tests/profile-modules.d.ts",
  "apps/jetbrains/src/main/kotlin/com/codem/intellij/core/rpc-peer.kt",
  "apps/jetbrains/host/plugin-build.gradle.kts",
  "packages/history/src/search/search-index.ts",
  "packages/history/tests/final-answer.test.ts",
  "packages/history/src/sharedCopy/final-answer.ts",
]) {
  it(`file naming gate: rejects ${file}`, async t => {
    const root = await repository(t, [file, "packages/app-server/src/controlPlane.ts"])
    assert.deepEqual(kebabCaseCodeFiles(root), [file])
    assert.throws(() => checkCodeFileNames(root), error => error instanceof Error && error.message.endsWith(`\n${file}`))
  })
}

it("file naming gate: rejects a new file before it is staged", async t => {
  const root = await repository(t, ["apps/vscode/src/chat/chatController.ts"])
  await put(root, "apps/vscode/src/chat/chat-controller.ts")
  assert.deepEqual(kebabCaseCodeFiles(root), ["apps/vscode/src/chat/chat-controller.ts"])
})
