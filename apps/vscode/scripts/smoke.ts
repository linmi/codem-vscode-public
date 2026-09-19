import { execFileSync, spawn } from "node:child_process"
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), "codemExtensionSmoke"))
try {
  const workspace = join(temporary, "workspace")
  await mkdir(workspace)
  const args = ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-extensions", "--disable-workspace-trust", `--user-data-dir=${join(temporary, "userData")}`, `--extensions-dir=${join(temporary, "extensions")}`, `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${join(root, "dist/extensionSmoke.cjs")}`, workspace]
  let executable = process.env.CODEM_VSCODE_EXECUTABLE
  if (!executable && process.platform === "darwin") {
    const bundle = "/Applications/Visual Studio Code.app/Contents"
    const name = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", join(bundle, "Info.plist")], { encoding: "utf8" }).trim()
    executable = join(bundle, "MacOS", name)
  }
  if (!executable) throw new Error("Set CODEM_VSCODE_EXECUTABLE to the VS Code application executable")
  const result = join(temporary, "result")
  const child = spawn(executable, args, { stdio: "inherit", env: { ...process.env, CODEM_SMOKE_RESULT: result, CODEM_INTERACTIONS_LIVE: process.argv.includes("--interactions") ? "1" : "0", CODEM_FEATURE_NODE: process.execPath, CODEM_RESOURCES_ONLY: process.argv.includes("--resources") ? "1" : "0", CODEM_LIVE_SMOKE: process.argv.includes("--live") ? "1" : "0", CODEM_FEATURE_LIVE: process.argv.includes("--features") ? "1" : "0" } })
  const timeout = setTimeout(() => child.kill(), (process.argv.includes("--features") || process.argv.includes("--interactions")) ? 720_000 : 120_000)
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("exit", resolve) })
    if (code !== 0) throw new Error(`VS Code smoke test failed (${String(code)})`)
    if (await readFile(result, "utf8") !== "ok") throw new Error("Extension Host did not confirm the smoke test")
  } finally { clearTimeout(timeout) }
} finally { await rm(temporary, { recursive: true, force: true }) }
