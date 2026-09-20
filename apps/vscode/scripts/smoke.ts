import { spawn } from "node:child_process"
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { vscodeExecutable } from "./support/vscodeExecutable.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
if (process.argv.includes("--images")) {
  if (!process.argv.includes("--live")) throw new Error("Image acceptance requires explicit test:live")
  const { runLiveImages } = await import("../tests/liveImages.ts")
  const temporary = await mkdtemp(join(tmpdir(), "codemImages"))
  try { await runLiveImages(root, temporary) }
  finally { await rm(temporary, { recursive: true, force: true }) }
} else if (process.argv.includes("--commit-messages")) {
  if (!process.argv.includes("--live")) throw new Error("Commit generation acceptance requires explicit test:live")
  const { runLiveCommitMessages } = await import("../tests/liveCommitMessages.ts")
  const temporary = await mkdtemp(join(tmpdir(), "codemCommitMessages"))
  try { await runLiveCommitMessages(root, temporary) }
  finally { await rm(temporary, { recursive: true, force: true }) }
} else if (process.argv.includes("--native-chat")) {
  if (!process.argv.includes("--live")) throw new Error("Native chat acceptance requires explicit test:live")
  const { runLiveNativeChat } = await import("../tests/liveNativeChat.ts")
  const temporary = await mkdtemp(join(tmpdir(), "codemNativeChat"))
  try { await runLiveNativeChat(root, temporary) }
  finally { await rm(temporary, { recursive: true, force: true }) }
} else if (process.argv.includes("--reply-delivery")) {
  if (!process.argv.includes("--live")) throw new Error("Reply delivery acceptance requires explicit --live")
  const { runLiveReplyDelivery } = await import("../tests/liveReplyDelivery.ts")
  const temporary = await mkdtemp(join(tmpdir(), "codemReplyDelivery"))
  try { await runLiveReplyDelivery(root, temporary) }
  finally { await rm(temporary, { recursive: true, force: true }) }
} else if (process.argv.includes("--capabilities")) {
  if (!process.argv.includes("--live")) throw new Error("Capabilities acceptance requires explicit --live")
  const { runLiveCapabilities } = await import("../tests/liveCapabilities.ts")
  const temporary = await mkdtemp(join(tmpdir(), "codemCapabilities"))
  try { await runLiveCapabilities(root, temporary, process.argv.includes("--compact-only")) }
  finally { await rm(temporary, { recursive: true, force: true }) }
} else {
const temporary = await mkdtemp(join(tmpdir(), "codemExtensionSmoke"))
try {
  const workspace = join(temporary, "workspace")
  await mkdir(workspace)
  await mkdir(join(workspace, ".vscode"))
  await writeFile(join(workspace, ".vscode", "settings.json"), JSON.stringify({ "codem.autoConnect": false }))
  if (process.argv.includes("--headless")) {
    if (!process.argv.includes("--live")) throw new Error("Headless connection checks require explicit test:live")
    const { runLiveConnection } = await import("../tests/liveConnection.ts")
    await runLiveConnection(root, workspace)
  } else {
    const args = ["--new-window", "--skip-welcome", "--skip-release-notes", "--disable-extensions", "--disable-workspace-trust", `--user-data-dir=${join(temporary, "userData")}`, `--extensions-dir=${join(temporary, "extensions")}`, `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${join(root, "dist/extensionSmoke.cjs")}`, workspace]
    const executable = vscodeExecutable()
    const result = join(temporary, "result")
    const child = spawn(executable, args, { stdio: "inherit", env: { ...process.env, CODEM_SMOKE_RESULT: result, CODEM_INTERACTIONS_LIVE: process.argv.includes("--interactions") ? "1" : "0", CODEM_FEATURE_NODE: process.execPath, CODEM_RESOURCES_ONLY: process.argv.includes("--resources") ? "1" : "0", CODEM_LIVE_SMOKE: process.argv.includes("--live") ? "1" : "0", CODEM_FEATURE_LIVE: process.argv.includes("--features") ? "1" : "0" } })
    const timeout = setTimeout(() => child.kill(), (process.argv.includes("--features") || process.argv.includes("--interactions")) ? 720_000 : 120_000)
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("exit", resolve) })
      if (code !== 0) throw new Error(`VS Code smoke test failed (${String(code)})`)
      if (await readFile(result, "utf8") !== "ok") throw new Error("Extension Host did not confirm the smoke test")
    } finally { clearTimeout(timeout) }
  }
} finally { await rm(temporary, { recursive: true, force: true }) }

}
