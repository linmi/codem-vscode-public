/**
 * Cycle 2 brand-sweep gate: the VS Code production surface must not keep
 * Kilo Marketplace catalog, installer, panel, or kilo.ai marketplace docs.
 *
 * CHANGELOG.md and VS Code Marketplace publishing copy may still mention
 * "marketplace" in other senses.
 */

import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const FORBIDDEN =
  /api\.kilo\.ai\/api\/marketplace|kilo\.ai\/docs\/customize\/marketplace|MarketplacePanelProvider|MarketplaceService|MarketplaceNotifier|openMarketplacePanel|marketplaceButtonClicked|CodeM Marketplace/gi
const SKIP_NAMES = new Set(["CHANGELOG.md", "marketplace-removed.test.ts", "kiloclaw-removed.test.ts"])

function collect(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name) || entry.name === "node_modules" || entry.name === "dist") continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collect(file))
    else files.push(file)
  }
  return files
}

describe("Kilo Marketplace production removal", () => {
  it("does not keep Marketplace sources, commands, or Kilo catalog endpoints in the VS Code app", () => {
    const files = [
      path.join(ROOT, "package.json"),
      path.join(ROOT, "esbuild.js"),
      path.join(ROOT, "knip.json"),
      path.join(ROOT, "tsconfig.json"),
      ...collect(path.join(ROOT, "src")),
      ...collect(path.join(ROOT, "webview-ui")),
      ...collect(path.join(ROOT, "tests")),
    ]

    const hits = files.flatMap((file) => {
      const src = fs.readFileSync(file, "utf-8")
      return Array.from(src.matchAll(FORBIDDEN), (match) => {
        const line = src.slice(0, match.index ?? 0).split("\n").length
        return `${path.relative(ROOT, file)}:${line}: ${match[0]}`
      })
    })

    expect(hits, hits.join("\n")).toEqual([])
    expect(fs.existsSync(path.join(ROOT, "src/services/marketplace"))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, "src/MarketplacePanelProvider.ts"))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, "webview-ui/marketplace"))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, "webview-ui/src/components/marketplace"))).toBe(false)
  })
})
