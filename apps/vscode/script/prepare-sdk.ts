#!/usr/bin/env node
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { extensionRoot, git, run } from "./node-run.ts"

const root = extensionRoot()
const repo = join(root, "..", "..")
const sdk = join(repo, "packages", "sdk", "js")
const cache = join(root, "node_modules", ".cache", "sdk-build.json")
const inputs = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "packages/opencode",
  "packages/core",
  "packages/effect-drizzle-sqlite",
  "packages/effect-sqlite-node",
  "packages/kilo-gateway",
  "packages/kilo-indexing",
  "packages/kilo-memory",
  "packages/kilo-sandbox",
  "packages/llm",
  "packages/plugin",
  "packages/plugin-atomic-chat",
  "packages/server",
  "packages/sdk/js/package.json",
  "packages/sdk/js/tsconfig.json",
  "packages/sdk/js/script",
  "apps/vscode/script/prepare-sdk.ts",
]
const outputs = ["packages/sdk/js/src"]

function log(msg: string) {
  console.log(`[prepare-sdk] ${msg}`)
}

function fingerprint(paths: string[]) {
  const tree = git(["ls-tree", "-r", "HEAD", "--", ...paths], repo)
  const diff = git(["diff", "--binary", "HEAD", "--", ...paths], repo)
  const extra = git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...paths], repo)
  const hash = createHash("sha256").update(tree).update(diff)
  const files = extra.split("\0").filter(Boolean).sort()
  for (const file of files) {
    hash.update(file)
    hash.update(readFileSync(join(repo, file)))
  }
  return hash.digest("hex")
}

function load() {
  if (!existsSync(cache)) return
  try {
    const value: unknown = JSON.parse(readFileSync(cache, "utf8"))
    if (!value || typeof value !== "object") return
    const input = Reflect.get(value, "input")
    const output = Reflect.get(value, "output")
    if (typeof input === "string" && typeof output === "string") return { input, output }
  } catch (err) {
    log(`Ignoring invalid cache: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const input = fingerprint(inputs)
const prior = load()
const ready = existsSync(join(sdk, "dist", "index.js")) && existsSync(join(sdk, "dist", "v2", "index.js"))

if (prior?.input === input && prior.output === fingerprint(outputs) && ready) {
  log("SDK inputs and generated output are unchanged")
  process.exit(0)
}

log("SDK inputs changed, rebuilding generated client")
run("pnpm", ["run", "build"], { cwd: sdk })

mkdirSync(dirname(cache), { recursive: true })
writeFileSync(cache, `${JSON.stringify({ input, output: fingerprint(outputs) })}\n`)
