import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { APP_SERVER_CLI_VERSION, resolveBundledAppServerRuntime, startAppServerConnection } from "@codem/app-server"

// Explicit native-binary smoke: initialize only, without login or model requests.
const extensionRoot = fileURLToPath(new URL("..", import.meta.url))
const runtime = await resolveBundledAppServerRuntime({ extensionRoot })
const root = await mkdtemp(join(tmpdir(), "codem native 中文 "))
try {
  const home = join(root, "home")
  await mkdir(home)
  const environment = { ...process.env, LINCO_HOME: home, CODEM_HOME: home, LINCO_SESSIONS_ROOT: join(home, "sessions") }
  const version = execFileSync(runtime.authExecutablePath, ["--version"], { cwd: root, env: environment, encoding: "utf8", timeout: 15_000, windowsHide: true }).trim()
  assert.ok(version.includes(APP_SERVER_CLI_VERSION), `Authentication binary version mismatch: ${version}`)
  const connection = await startAppServerConnection({ runtime, workingDirectory: root, environment, clientInfo: { name: "codem-runtime-smoke", version: "0.2.0" }, initializeTimeoutMs: 15_000 })
  try { assert.equal(connection.initialization.protocolVersion, 1) }
  finally { await connection.close() }
  console.log(`CODEM_RUNTIME_SMOKE_OK: ${runtime.target}, Core ${runtime.coreVersion}, CLI ${runtime.cliVersion}`)
} finally { await rm(root, { recursive: true, force: true }) }
