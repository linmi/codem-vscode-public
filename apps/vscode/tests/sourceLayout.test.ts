import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { it, type TestContext } from "node:test"
import { checkSourceLayout } from "./sourceLayoutChecks.ts"

const workspace = fileURLToPath(new URL("../../..", import.meta.url))
async function put(root: string, path: string): Promise<void> {
  const file = join(root, "apps/vscode", path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, "")
}
async function fixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codem-layout-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const path of ["src/extension.ts", "src/chat/chatController.ts", "src/shared/messages.ts", "webview/main.ts", "webview/styles.css", "webview/tsconfig.json", "webview/composer/composerView.ts", "webview/components/ui/button.tsx", "webview/components/componentStyles.ts"]) await put(root, path)
  return root
}

it("directory gate: active application uses documented feature directories", async () => { await checkSourceLayout(workspace) })
it("directory gate: accepts entrypoints, config, feature code and UI primitives", async t => { await checkSourceLayout(await fixture(t)) })
for (const path of ["src/chatController.ts", "webview/composerState.ts", "webview/components/composerMode.tsx", "webview/panels.css"]) {
  it(`directory gate: rejects flat implementation at ${path}`, async t => {
    const root = await fixture(t)
    await put(root, path)
    await assert.rejects(checkSourceLayout(root), /implementation must live in its feature directory/)
  })
}
it("directory gate: rejects an undocumented catch-all directory", async t => {
  const root = await fixture(t)
  await put(root, "src/managers/everything.ts")
  await assert.rejects(checkSourceLayout(root), /undocumented feature directory/)
})
