import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const vscodeRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const scriptDir = join(vscodeRoot, "script")

function source(name: string) {
  return readFileSync(join(scriptDir, name), "utf8")
}

describe("VS Code production scripts", () => {
  it("keeps prepare, package, launch, and watch off leftover Bun", () => {
    const files = [
      "node-run.ts",
      "prepare-app-server-runtime.ts",
      "prepare-sdk.ts",
      "package-dev.ts",
      "launch.ts",
      "watch-dev.ts",
      "run-extension-host-test.ts",
    ]
    for (const file of files) {
      const text = source(file)
      if (file !== "node-run.ts") assert.match(text, /^#!\/usr\/bin\/env node/m, file)
      assert.equal(/from ["']bun["']/.test(text), false, file)
      assert.equal(/\bBun\./.test(text), false, file)
      assert.equal(/import\.meta\.dir/.test(text), false, file)
    }
    const pkg = JSON.parse(readFileSync(join(vscodeRoot, "package.json"), "utf8")) as { scripts: Record<string, string> }
    for (const name of [
      "prepare:app-server-runtime",
      "prepare:sdk",
      "package",
      "package:dev",
      "build:launch",
      "compile",
      "watch",
      "watch:esbuild",
      "extension",
      "test:extension-host",
    ]) {
      assert.equal(/\bbun\b/.test(pkg.scripts[name] ?? ""), false, name)
    }
    assert.equal(/\bprepare:cli-binary\b/.test(pkg.scripts.package ?? ""), false)
    assert.equal(/\bprepare:cli-binary\b/.test(pkg.scripts["build:launch"] ?? ""), false)
  })

  it("stages the current-platform App Server runtime with Node", () => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", join(scriptDir, "prepare-app-server-runtime.ts")],
      { cwd: vscodeRoot, encoding: "utf8" },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Prepared CodeM App Server/)
    assert.match(result.stdout, /Prepared CodeM authentication broker/)
    assert.equal(readdirSync(join(vscodeRoot, "bin", "app-server")).includes("codem-core"), true)
  })
})
