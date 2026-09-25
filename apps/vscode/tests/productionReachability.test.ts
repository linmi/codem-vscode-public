import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { it, type TestContext } from "node:test"
import { productionEntries } from "../scripts/support/productionEntries.ts"
import { checkProductionReachability, unreachableSources } from "./productionReachabilityChecks.ts"

const application = fileURLToPath(new URL("..", import.meta.url))
const entries = [{ path: "src/extension.ts", platform: "node" }, { path: "webview/main.ts", platform: "browser" }] as const

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

/** A live tree that reaches files through value, type-only, re-export, dynamic and require imports. */
async function fixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codem-reachability-app-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await put(root, "tsconfig.json", JSON.stringify({ compilerOptions: { module: "ESNext", moduleResolution: "Bundler", target: "ES2022", allowImportingTsExtensions: true, noEmit: true, strict: true, types: [] } }))
  await put(root, "src/extension.ts", 'import { value } from "./chat/controller.ts"\nexport { value }\nexport const load = () => import("./chat/lazy.ts")\nexport const legacy = require("./chat/required.ts")\n')
  await put(root, "src/chat/required.ts", "export const required = 1\n")
  await put(root, "src/chat/controller.ts", 'import type { Shape } from "../shared/types.ts"\nexport { format } from "../shared/format.ts"\nexport const value: Shape = { size: 1 }\n')
  await put(root, "src/chat/lazy.ts", "export const lazy = 1\n")
  await put(root, "src/shared/types.ts", "export interface Shape { size: number }\n")
  await put(root, "src/shared/format.ts", "export const format = (value: number) => String(value)\n")
  await put(root, "src/shared/ambient.d.ts", "declare const ambient: string\n")
  await put(root, "webview/main.ts", 'import { bridge } from "./host/bridge.ts"\nbridge()\n')
  await put(root, "webview/host/bridge.ts", "export function bridge(): void {}\n")
  await put(root, "tests/controller.test.ts", 'import "../src/shared/testOnly.ts"\n')
  return root
}

it("production reachability: every TypeScript file under src/ and webview/ ships from a production entry", async () => {
  await checkProductionReachability(application, Object.values(productionEntries))
})

it("production reachability: accepts value, type-only, re-export, dynamic and require imports and ignores declarations", async t => {
  assert.deepEqual(await unreachableSources(await fixture(t), entries), [])
})

it("production reachability: rejects orphans, files kept alive only by orphans or tests, and orphaned types", async t => {
  const root = await fixture(t)
  await put(root, "webview/transcript/messageView.tsx", 'import { helper } from "../../src/shared/deadHelper.ts"\nexport const view = helper\n')
  await put(root, "src/shared/deadHelper.ts", 'import type { Legacy } from "./legacyTypes.ts"\nexport const helper: Legacy = 1\n')
  await put(root, "src/shared/legacyTypes.ts", "export type Legacy = number\n")
  await put(root, "src/shared/testOnly.ts", "export const testOnly = 1\n")
  const expected = ["src/shared/deadHelper.ts", "src/shared/legacyTypes.ts", "src/shared/testOnly.ts", "webview/transcript/messageView.tsx"]
  assert.deepEqual(await unreachableSources(root, entries), expected)
  await assert.rejects(checkProductionReachability(root, entries), error => {
    assert.match((error as Error).message, /Not reachable from any production entry \(src\/extension\.ts, webview\/main\.ts\)/)
    for (const path of expected) assert.ok((error as Error).message.includes(path), path)
    return true
  })
})

it("production reachability: a file that only a dropped entry reached becomes unreachable", async t => {
  const root = await fixture(t)
  assert.deepEqual(await unreachableSources(root, [entries[0]]), ["webview/host/bridge.ts", "webview/main.ts"])
})
