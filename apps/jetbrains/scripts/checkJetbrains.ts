import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const app = join(dirname(fileURLToPath(import.meta.url)), "..")
const plugin = process.argv.includes("--plugin")
const runtime = process.argv.includes("--runtime")
const compileOnly = process.argv.includes("--compile-only")

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function resolveJavaHome(): string | undefined {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME
  const candidates = [
    "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
    "/opt/homebrew/opt/openjdk@21",
    "/usr/lib/jvm/java-21-openjdk",
  ]
  return candidates.find((home) => existsSync(join(home, "bin", "java")))
}

const javaHome = resolveJavaHome()
const java = javaHome ? join(javaHome, "bin", "java") : "java"
const probe = spawnSync(java, ["-version"], { encoding: "utf8" })
if (probe.error || probe.status !== 0) {
  fail("CodeM JetBrains check requires JDK 21+. JAVA_HOME is unset or java is missing; refusing to skip.")
}
const versionText = `${probe.stdout}\n${probe.stderr}`
const match = /version "(\d+)/u.exec(versionText)
if (!match || Number(match[1]) < 21) {
  fail(`CodeM JetBrains check requires JDK 21+, found ${versionText.trim() || "unknown"}`)
}

const gradlew = process.platform === "win32" ? join(app, "gradlew.bat") : join(app, "gradlew")
if (!existsSync(gradlew)) {
  fail(`CodeM JetBrains Gradle wrapper is missing: ${gradlew}`)
}
const task = runtime ? "runtimeTest" : plugin ? "buildPlugin" : compileOnly ? "compileKotlin" : "domainTest"
const result = spawnSync(gradlew, [task, "--no-daemon"], {
  cwd: app,
  stdio: "inherit",
  env: { ...process.env, JAVA_HOME: javaHome ?? process.env.JAVA_HOME },
})
process.exit(result.status ?? 1)
