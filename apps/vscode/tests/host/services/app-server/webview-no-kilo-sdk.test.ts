import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const vscodeRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const webviewSrc = join(vscodeRoot, "webview-ui", "src")
const uiSrc = join(vscodeRoot, "../../packages/ui/src")
const vscodePackage = join(vscodeRoot, "package.json")

function readSourceTree(directory: string): string {
  return readSourceTreeExcept(directory)
}

function readSourceTreeExcept(directory: string, skip?: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name)
      if (skip && path === skip) return ""
      return entry.isDirectory() ? readSourceTreeExcept(path, skip) : readFileSync(path, "utf8")
    })
    .join("\n")
}

describe("Webview leftover SDK cutover", () => {
  it("does not import leftover @kilocode packages from webview production source", () => {
    const source = readSourceTree(webviewSrc)
    assert.equal(/from\s+["']@kilocode\/sdk/.test(source), false)
    assert.equal(/from\s+["']@kilocode\/kilo-/.test(source), false)
    assert.equal(/from\s+["']@kilocode\/plugin/.test(source), false)
  })

  it("keeps @codem/ui presentation types off leftover SDK", () => {
    assert.equal(existsSync(join(uiSrc, "types", "session.ts")), true)
    const source = readSourceTree(uiSrc)
    assert.equal(/from\s+["']@kilocode\/sdk/.test(source), false)
    const pkg = JSON.parse(readFileSync(join(uiSrc, "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
      exports?: Record<string, string>
    }
    assert.equal(pkg.dependencies?.["@kilocode/sdk"], undefined)
    assert.equal(pkg.exports?.["./types/session"], "./src/types/session.ts")
  })

  it("does not import leftover @kilocode/sdk from Host production source except leftover-sdk.ts", () => {
    const hostSrc = join(vscodeRoot, "src")
    const leftoverPath = join(hostSrc, "services", "cli-backend", "leftover-sdk.ts")
    assert.equal(existsSync(leftoverPath), true)
    assert.match(readFileSync(leftoverPath, "utf8"), /from ["']@kilocode\/sdk\/v2\/client["']/)
    const source = readSourceTreeExcept(hostSrc, leftoverPath)
    assert.equal(/from\s+["']@kilocode\/sdk/.test(source), false)
    assert.match(source, /from ["']@codem\/ui\/types\/session["']/)
    assert.match(source, /createKiloClient/)
    assert.match(source, /leftover-sdk/)
  })

  it("fail-closes leftover createKiloClient instead of building a REST client", async () => {
    const { createKiloClient } = await import("../../../../src/services/cli-backend/leftover-sdk.ts")
    assert.throws(() => createKiloClient({ baseUrl: "http://127.0.0.1:0" }), /尚未迁移到 CodeM App Server/)
  })

  it("drops leftover marketplace keywords from the VS Code shell", () => {
    const pkg = JSON.parse(readFileSync(vscodePackage, "utf8")) as { keywords?: string[] }
    const keywords = new Set(pkg.keywords ?? [])
    for (const leftover of ["zoo code", "opencode", "open code"]) {
      assert.equal(keywords.has(leftover), false, leftover)
    }
  })
})
