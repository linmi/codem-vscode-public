import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * 把插件装进本机已开的 IntelliJ IDEA 2026.2.3，并自动重载**同一个** IU。
 * 禁止 runIde / 沙箱 / Community / 第二套 IDE。JCEF Tool Window 不能动态加载。
 */
const jetbrains = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = resolve(jetbrains, "../..")
const ideaApp = "/Applications/IntelliJ IDEA.app"
const ideaBinary = join(ideaApp, "Contents/MacOS/idea")
const restarter = join(ideaApp, "Contents/bin/restarter")
const ideaConfig = join(homedir(), "Library/Application Support/JetBrains/IntelliJIdea2026.2")
const pluginsRoot = join(ideaConfig, "plugins")
const pluginDir = join(pluginsRoot, "codem")
const ideaLog = join(homedir(), "Library/Logs/JetBrains/IntelliJIdea2026.2/idea.log")
const skipBuild = process.argv.includes("--skip-build")

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function resolveJavaHome(): string | undefined {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME
  const candidates = [
    "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
    "/opt/homebrew/opt/openjdk@21",
  ]
  return candidates.find((home) => existsSync(join(home, "bin", "java")))
}

function readPlist(key: string): string {
  const result = spawnSync("defaults", ["read", join(ideaApp, "Contents/Info"), key], { encoding: "utf8" })
  return result.stdout.trim()
}

function executableOf(pid: number): string | null {
  const result = spawnSync("lsof", ["-p", String(pid), "-a", "-d", "txt", "-Fn"], { encoding: "utf8" })
  const line = result.stdout.split("\n").find((entry) => entry.startsWith("n/") && entry.endsWith("MacOS/idea"))
  return line ? line.slice(1) : null
}

function ideaProcesses(): { pid: number; exe: string }[] {
  const listed = spawnSync("pgrep", ["-x", "idea"], { encoding: "utf8" })
  const found: { pid: number; exe: string }[] = []
  for (const text of listed.stdout.split("\n")) {
    const pid = Number(text.trim())
    if (!Number.isInteger(pid) || pid <= 0) continue
    const exe = executableOf(pid)
    if (exe) found.push({ pid, exe })
  }
  return found
}

function ideaPids(): number[] {
  return ideaProcesses().filter((process) => process.exe === ideaBinary).map((process) => process.pid)
}

function rejectForeignIdea(): void {
  const foreign = ideaProcesses().filter((process) => process.exe !== ideaBinary)
  if (foreign.length > 0) {
    fail(`CodeM installAndReload refused a second IDE: ${foreign.map((process) => process.exe).join(", ")}`)
  }
}

function run(command: string, args: string[], cwd = jetbrains): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, JAVA_HOME: resolveJavaHome() ?? process.env.JAVA_HOME },
  })
  if (result.status !== 0) fail(`CodeM installAndReload failed: ${command} ${args.join(" ")}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function waitUntil(label: string, timeoutMs: number, ready: () => boolean): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (ready()) return
    await sleep(400)
  }
  fail(`CodeM installAndReload timed out: ${label}`)
}

function saveThenQuit(): void {
  spawnSync("osascript", [
    "-e",
    'tell application "System Events" to tell process "idea" to keystroke "s" using {command down, option down}',
  ], { encoding: "utf8", timeout: 4000 })
  const quit = spawnSync("osascript", ["-e", 'tell application "IntelliJ IDEA" to quit'], {
    encoding: "utf8",
    timeout: 15_000,
  })
  if (quit.status !== 0) {
    console.warn("CodeM installAndReload AppleScript quit did not confirm; waiting for the process anyway")
  }
}

function startRestarter(pid: number): void {
  if (!existsSync(restarter)) fail(`CodeM installAndReload missing IDEA restarter: ${restarter}`)
  const child = spawn(restarter, [String(pid), "3", "/usr/bin/open", "-a", ideaApp, repoRoot], {
    detached: true,
    stdio: "ignore",
  })
  child.unref()
}

function installZip(): { zip: string; jar: string } {
  const dist = join(jetbrains, "host/build/distributions")
  const zip = readdirSync(dist).filter((name) => name.endsWith(".zip")).sort().at(-1)
  if (!zip) fail("CodeM installAndReload found no plugin zip; run buildPlugin first")
  const zipPath = join(dist, zip)
  mkdirSync(pluginsRoot, { recursive: true })
  rmSync(pluginDir, { recursive: true, force: true })
  rmSync(join(pluginsRoot, "host"), { recursive: true, force: true })
  run("unzip", ["-o", zipPath, "-d", pluginsRoot])
  if (existsSync(join(pluginsRoot, "host"))) {
    rmSync(pluginDir, { recursive: true, force: true })
    spawnSync("mv", [join(pluginsRoot, "host"), pluginDir])
  }
  const jar = join(pluginDir, "lib/host-0.1.0.jar")
  if (!existsSync(jar)) fail(`CodeM installAndReload missing installed jar: ${jar}`)
  const listed = spawnSync("unzip", ["-l", jar], { encoding: "utf8" })
  if (!listed.stdout.includes("AccountProjection.class") || !listed.stdout.includes("ToolWindowHost.class") || !listed.stdout.includes("codem-ui/browser.js")) {
    fail("CodeM installAndReload installed a jar without the sign-in host or UI bundle")
  }
  const stamp = {
    installedAt: new Date().toISOString(),
    zip,
    project: repoRoot,
    marker: "beginSignIn",
  }
  writeFileSync(join(pluginDir, "codem-reload.json"), `${JSON.stringify(stamp, null, 2)}\n`)
  return { zip: zipPath, jar }
}

function logContainsAfter(offset: number, needle: string): boolean {
  if (!existsSync(ideaLog)) return false
  const text = readFileSync(ideaLog, "utf8").slice(offset)
  return text.includes(needle)
}

async function main(): Promise<void> {
  if (process.platform !== "darwin") fail("CodeM installAndReload only reloads macOS /Applications/IntelliJ IDEA.app")
  if (!existsSync(ideaApp) || !existsSync(ideaBinary)) fail(`CodeM installAndReload missing ${ideaApp}`)
  const identifier = readPlist("CFBundleIdentifier")
  const version = readPlist("CFBundleShortVersionString")
  if (identifier !== "com.jetbrains.intellij") {
    fail(`CodeM installAndReload refused ${identifier}; only IntelliJ IDEA (IU) is allowed`)
  }
  rejectForeignIdea()
  const before = ideaPids()
  if (before.length > 1) fail(`CodeM installAndReload found ${before.length} IU processes; refusing to stack windows`)
  console.log(`CodeM installAndReload target: ${ideaApp} ${version} pids=${before.join(",") || "none"} project=${repoRoot}`)

  if (!skipBuild) {
    const gradlew = join(jetbrains, "gradlew")
    run(gradlew, [":host:buildPlugin", "--offline", "--no-daemon"])
  }
  const installed = installZip()
  const logOffset = existsSync(ideaLog) ? statSync(ideaLog).size : 0
  console.log(`CodeM plugin installed: ${installed.jar}`)

  if (before.length === 1) {
    const pid = before[0]!
    startRestarter(pid)
    saveThenQuit()
    await waitUntil(`IU ${pid} exit`, 90_000, () => !ideaPids().includes(pid))
    await sleep(2_000)
    if (ideaPids().length === 0) {
      run("/usr/bin/open", ["-a", ideaApp, repoRoot], repoRoot)
    }
  } else {
    run("/usr/bin/open", ["-a", ideaApp, repoRoot], repoRoot)
  }

  await waitUntil("same IU relaunch", 90_000, () => ideaPids().length === 1)
  const after = ideaPids()
  if (after.length !== 1) fail(`CodeM installAndReload expected one IU, found ${after.join(",")}`)
  if (before[0] !== undefined && after[0] === before[0]) {
    fail("CodeM installAndReload did not start a new IU process")
  }
  await waitUntil("CodeM plugin loaded", 90_000, () => logContainsAfter(logOffset, "Loaded custom plugins") && logContainsAfter(logOffset, "CodeM"))
  rejectForeignIdea()
  console.log(`CodeM already reloaded IU ${after[0]} ${version} with ${installed.zip}`)
}

await main()
