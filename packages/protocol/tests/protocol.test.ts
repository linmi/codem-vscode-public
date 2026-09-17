import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"
import {
  CODEM_BUILTIN_INTELLIGENCE_TIERS,
  parseCodemPermissionMode,
  type CodemModelCatalog,
  type CodemModeState,
  type CodemSkillSummary,
} from "../src/index.ts"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const sourceRoot = join(packageRoot, "src")

function readSourceTree(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? readSourceTree(path) : readFileSync(path, "utf8")
    })
    .join("\n")
}

describe("@codem/protocol catalog and mode DTOs", () => {
  it("parses the three native permission modes and rejects anything else", () => {
    for (const mode of ["default", "auto", "yolo"] as const) {
      assert.equal(parseCodemPermissionMode(mode), mode)
    }
    for (const value of ["acceptEdits", "unknown", true, 1, null]) {
      assert.throws(() => parseCodemPermissionMode(value), /Invalid CodeM permissionMode/)
    }
  })

  it("keeps the builtin intelligence whitelist used by the model picker", () => {
    assert.deepEqual(CODEM_BUILTIN_INTELLIGENCE_TIERS, ["low", "medium", "high", "xhigh"])
  })

  it("accepts only the catalog and mode fields already posted to Webview", () => {
    const catalog: CodemModelCatalog = {
      activeModel: "codem-router/auto",
      models: [{ id: "codem-router/auto", source: "builtin", contextWindowTokens: 256000, supportsVision: false }],
    }
    const skills: readonly CodemSkillSummary[] = [{ name: "review", description: "Review code" }]
    const state: CodemModeState = {
      revision: 1,
      permissionEpoch: 0,
      permissionMode: "auto",
      workMode: "normal",
    }
    assert.equal(catalog.models[0]?.id, "codem-router/auto")
    assert.equal(skills[0]?.name, "review")
    assert.equal(state.workMode, "normal")
  })

  it("does not import Node, VS Code, Electron, DOM, or leftover SDK packages from src/", () => {
    const source = readSourceTree(sourceRoot)
    assert.equal(/from\s+["']node:/.test(source), false)
    assert.equal(/from\s+["'](?:vscode|electron)["']/.test(source), false)
    assert.equal(/from\s+["'](?:fs|path|child_process)["']/.test(source), false)
    assert.equal(/["']@opencode-ai/.test(source), false)
    assert.equal(/["']@kilocode/.test(source), false)
  })

  it("lives at packages/protocol as the only @codem/protocol package", () => {
    assert.equal(basename(packageRoot), "protocol")
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { name?: string }
    assert.equal(pkg.name, "@codem/protocol")
    assert.equal(existsSync(join(packageRoot, "..", "codem-protocol")), false)
    const siblingDirs = readdirSync(join(packageRoot, ".."), { withFileTypes: true })
    for (const entry of siblingDirs) {
      if (!entry.isDirectory()) continue
      const siblingPkgPath = join(packageRoot, "..", entry.name, "package.json")
      if (!existsSync(siblingPkgPath)) continue
      const sibling = JSON.parse(readFileSync(siblingPkgPath, "utf8")) as { name?: string }
      assert.notEqual(sibling.name, "@opencode-ai/protocol")
      if (entry.name !== "protocol") assert.notEqual(sibling.name, "@codem/protocol")
    }
  })

  it("declares no runtime or leftover SDK dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      dependencies?: unknown
      peerDependencies?: unknown
      optionalDependencies?: unknown
    }
    const manifest = JSON.stringify(pkg)
    assert.equal(pkg.dependencies, undefined)
    assert.equal(pkg.peerDependencies, undefined)
    assert.equal(pkg.optionalDependencies, undefined)
    assert.equal(/@opencode-ai|@kilocode/.test(manifest), false)
  })
})
