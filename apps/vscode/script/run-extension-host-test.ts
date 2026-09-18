#!/usr/bin/env node
/**
 * 打包并在隔离 VS Code 里跑 tests/extension-host/*.ts。
 * 不隔离 ~/.codem：credential broker 必须沿用本机已有登录。
 * 成功看工作区 EXTENSION_HOST_RESULT.txt / 控制台 PASS 标记，不编造成功。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { extensionRoot, run } from "./node-run.ts"

const root = extensionRoot()
const allowed = ["hitl-reload", "live-send", "history", "permission-mode", "spaces"] as const
const argv = process.argv.slice(2).filter((item) => item !== "--")
const name = (argv.find((item) => !item.startsWith("--")) ?? "hitl-reload") as (typeof allowed)[number]
if (!allowed.includes(name)) {
  console.error(`Unknown Extension Host test ${name}. Use: ${allowed.join(", ")}`)
  process.exit(2)
}

const skipBuild = argv.includes("--skip-build")
const codeExecutable = process.env.VSCODE_EXEC_PATH ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code"
if (!existsSync(codeExecutable)) {
  console.error(`VS Code executable not found: ${codeExecutable}`)
  process.exit(2)
}

const workspace = mkdtempSync(join(tmpdir(), "ceh-ws-"))
const state = mkdtempSync(join("/tmp", "ceh-"))
const userDir = join(state, "u")
const extDir = join(state, "e")
const outfile = join(root, "dist", "tests", `${name}.cjs`)
const resultPath = join(workspace, "EXTENSION_HOST_RESULT.txt")
const marker =
  name === "hitl-reload"
    ? "HITL_RELOAD_EXTENSION_HOST_PASS"
    : name === "live-send"
      ? "LIVE_SEND_EXTENSION_HOST_PASS"
      : name === "history"
        ? "HISTORY_EXTENSION_HOST_PASS"
        : name === "spaces"
          ? "SPACES_EXTENSION_HOST_PASS"
          : "PERMISSION_MODE_EXTENSION_HOST_PASS"

mkdirSync(join(userDir, "User"), { recursive: true })
mkdirSync(extDir, { recursive: true })
writeFileSync(
  join(userDir, "User", "settings.json"),
  `${JSON.stringify(
    {
      "security.workspace.trust.enabled": false,
      "extensions.autoCheckUpdates": false,
      "extensions.autoUpdate": false,
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "workbench.startupEditor": "none",
    },
    null,
    2,
  )}\n`,
)

if (!skipBuild || !existsSync(join(root, "dist", "extension.js"))) {
  console.log("[extension-host] bundle:production")
  run("pnpm", ["run", "bundle:production"], { cwd: root })
}

mkdirSync(join(root, "dist", "tests"), { recursive: true })
console.log(`[extension-host] esbuild ${name}.ts`)
run(
  "pnpm",
  [
    "exec",
    "esbuild",
    join("tests", "extension-host", `${name}.ts`),
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--external:vscode",
    `--outfile=${outfile}`,
  ],
  { cwd: root },
)

const args = [
  workspace,
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${outfile}`,
  `--user-data-dir=${userDir}`,
  `--extensions-dir=${extDir}`,
  "--disable-extensions",
  "--disable-workspace-trust",
  "--skip-welcome",
  "--skip-release-notes",
]
console.log(`[extension-host] ${codeExecutable}`)
console.log(`[extension-host] workspace ${workspace}`)

const env = { ...process.env, CODEM_EXTENSION_HOST_RESULT: resultPath }
for (const key of Object.keys(env)) {
  if (key.startsWith("ELECTRON_") || key.startsWith("VSCODE_")) delete env[key]
}

const child = spawn(codeExecutable, args, {
  cwd: workspace,
  env,
  stdio: ["ignore", "pipe", "pipe"],
})
let output = ""
child.stdout?.on("data", (chunk) => {
  const text = String(chunk)
  output += text
  process.stdout.write(text)
})
child.stderr?.on("data", (chunk) => {
  const text = String(chunk)
  output += text
  process.stderr.write(text)
})

const timeoutMs = name === "hitl-reload" || name === "live-send" ? 240_000 : 90_000
const completed = await new Promise<{ code: number | null }>((resolve) => {
  const timer = setTimeout(() => {
    child.kill("SIGTERM")
    resolve({ code: null })
  }, timeoutMs)
  child.once("close", (code) => {
    clearTimeout(timer)
    resolve({ code })
  })
})

const result = existsSync(resultPath) ? readFileSync(resultPath, "utf8") : ""
const spawnedKilo = /kilo server listening|Spawning CLI process:.*serve/.test(output)
const passed = (result.includes(marker) || output.includes(marker)) && !spawnedKilo
console.log(`[extension-host] exit=${String(completed.code)} result=${result.trim() || "<missing>"}`)
rmSync(state, { recursive: true, force: true })
if (spawnedKilo) {
  console.error("Live blocker: Extension Host spawned kilo serve. App Server must be the only live transport.")
}
if (!passed) {
  console.error(
    [
      `Extension Host ${name} did not pass.`,
      `workspace=${workspace}`,
      "This is a live blocker, not a fixture pass.",
    ].join("\n"),
  )
  process.exit(1)
}
rmSync(workspace, { recursive: true, force: true })
console.log(`[extension-host] ${marker}`)
