import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const source = resolve(fileURLToPath(import.meta.url), "../../../../../..")
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "codem-launch-")))
  dirs.push(repo)
  for (const path of ["", "apps/vscode", "packages/app-server", "packages/sdk/js"]) {
    const dir = join(repo, path)
    mkdirSync(dir, { recursive: true })
    symlinkSync(join(source, path, "node_modules"), join(dir, "node_modules"), "junction")
  }
  const root = join(repo, "apps/vscode")
  mkdirSync(join(root, "script"))
  cpSync(join(source, "apps/vscode/script/launch.ts"), join(root, "script/launch.ts"))
  cpSync(join(source, "apps/vscode/script/node-run.ts"), join(root, "script/node-run.ts"))
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      scripts: {
        "build:launch": "node -e \"require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/extension.js','built')\"",
      },
    }),
  )
  const workspace = join(repo, "workspace")
  mkdirSync(workspace)
  const fakeCode = join(repo, "fake-code.mjs")
  writeFileSync(
    fakeCode,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
writeFileSync("opened.json", JSON.stringify(process.argv.slice(2)))
`,
  )
  chmodSync(fakeCode, 0o755)
  return {
    root,
    workspace,
    run: (args: string[] = ["--no-build"]) =>
      spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          join(root, "script/launch.ts"),
          "--isolated",
          "--wait",
          "--app-path",
          fakeCode,
          "--workspace",
          workspace,
          ...args,
        ],
        {
          cwd: repo,
          env: { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].join(delimiter) },
          encoding: "utf8",
        },
      ),
  }
}

describe("extension launch build", () => {
  it("builds a fresh worktree before launching even with --no-build", () => {
    const item = fixture()
    const result = item.run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(join(item.root, "dist/extension.js"), "utf8"), "built")
    assert.equal(
      JSON.parse(readFileSync(join(item.workspace, "opened.json"), "utf8")).includes(
        `--extensionDevelopmentPath=${item.root}`,
      ),
      true,
    )
  })

  it("reuses an existing bundle with --no-build", () => {
    const item = fixture()
    mkdirSync(join(item.root, "dist"), { recursive: true })
    writeFileSync(join(item.root, "dist/extension.js"), "previous")
    assert.equal(item.run().status, 0)
    assert.equal(readFileSync(join(item.root, "dist/extension.js"), "utf8"), "previous")
    assert.equal(existsSync(join(item.workspace, "opened.json")), true)
  })

  it("rebuilds an existing bundle by default", () => {
    const item = fixture()
    mkdirSync(join(item.root, "dist"), { recursive: true })
    writeFileSync(join(item.root, "dist/extension.js"), "previous")
    assert.equal(item.run([]).status, 0)
    assert.equal(readFileSync(join(item.root, "dist/extension.js"), "utf8"), "built")
  })

  it("does not launch when the required build fails", () => {
    const item = fixture()
    writeFileSync(
      join(item.root, "package.json"),
      JSON.stringify({ scripts: { "build:launch": "node -e \"process.exit(1)\"" } }),
    )
    assert.equal(item.run().status, 1)
    assert.equal(existsSync(join(item.workspace, "opened.json")), false)
  })
})
