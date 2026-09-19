import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")

describe("Webview bundle architecture", () => {
  it("builds shared ESM chunks and loads entry points as modules", () => {
    const buildScript = fs.readFileSync(path.join(ROOT, "esbuild.js"), "utf8")
    const webviewHtml = fs.readFileSync(path.join(ROOT, "src/utils.ts"), "utf8")

    expect(buildScript).toContain('format: "esm"')
    expect(buildScript).toContain("splitting: true")
    expect(buildScript).toContain('chunkNames: "chunks/[name]-[hash]"')
    expect(webviewHtml).toContain('nonce="${nonce}" type="module" src="${opts.scriptUri}"')
  })
})
