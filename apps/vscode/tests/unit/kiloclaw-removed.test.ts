/**
 * Cycle 1 brand-sweep gate: the VS Code production surface must not keep
 * KiloClaw / "CodeM Cloud" panel entry points, sources, or claw endpoints.
 *
 * CHANGELOG.md may still mention historical KiloClaw work.
 */

import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const FORBIDDEN = /KiloClaw|kiloclaw|openKiloClaw|cloudAgentOpen|CloudAgentPanel|app\.kilo\.ai\/claw/gi
const SKIP_NAMES = new Set(["CHANGELOG.md", "kiloclaw-removed.test.ts", "marketplace-removed.test.ts"])

function collect(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name) || entry.name === "node_modules" || entry.name === "dist") continue
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collect(file))
    else files.push(file)
  }
  return files
}

describe("KiloClaw production removal", () => {
  it("does not keep KiloClaw sources, commands, or claw endpoints in the VS Code app", () => {
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
    expect(fs.existsSync(path.join(ROOT, "src/kiloclaw"))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, "webview-ui/kiloclaw"))).toBe(false)
  })
})
