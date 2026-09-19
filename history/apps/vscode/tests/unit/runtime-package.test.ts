import { describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { listFiles, PackageManager } from "@vscode/vsce"

describe("CodeM runtime packaging", () => {
  it("excludes Kilo and voice resources on both platforms while retaining CodeM", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "codem-package-"))
    try {
      writeFileSync(
        path.join(cwd, "package.json"),
        JSON.stringify({ name: "codem", version: "0.0.0", publisher: "codem", engines: { vscode: "^1.105.1" } }),
      )
      writeFileSync(path.join(cwd, "README.md"), "CodeM packaging fixture")
      writeFileSync(path.join(cwd, ".vscodeignore"), readFileSync(path.join(import.meta.dir, "../../.vscodeignore")))
      const retired = [
        "bin/ffmpeg",
        "bin/ffmpeg.exe",
        "bin/.ffmpeg-target",
        "bin/.cli-version",
        "bin/kilo",
        "bin/kilo.exe",
        "bin/tree-sitter/tree-sitter.wasm",
        "bin/kilo-sandbox-mutation-worker.js",
        "bin/bwrap",
        "bin/kilo-sandbox-seccomp",
        "bin/licenses/bubblewrap/COPYING",
      ]
      const retained = [
        "bin/app-server/codem-core",
        "bin/app-server/codem-auth",
        "bin/app-server/codem-core.exe",
        "bin/app-server/codem-auth.exe",
        "bin/app-server/LICENSE.core",
        "bin/app-server/LICENSE.auth",
        "bin/app-server/runtime.json",
      ]
      for (const file of [...retired, ...retained]) {
        mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
        writeFileSync(path.join(cwd, file), "fixture")
      }
      const files = await listFiles({ cwd, packageManager: PackageManager.None })
      for (const file of retired) expect(files).not.toContain(file)
      for (const file of retained) expect(files).toContain(file)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
