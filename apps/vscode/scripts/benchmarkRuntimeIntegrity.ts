/**
 * Wall time and event-loop blocking of bundled runtime verification. No Core process, no VS Code.
 * Uses the real bundle staged by `pnpm build:vscode` when present; otherwise a generated bundle
 * of the same sizes (Core ~13 MB, authentication CLI ~77 MB). Page cache is warm after the first sample.
 *
 *   node --experimental-strip-types apps/vscode/scripts/benchmarkRuntimeIntegrity.ts [--samples 7]
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  APP_SERVER_BUNDLE_DIRECTORY, APP_SERVER_BUNDLE_MANIFEST, APP_SERVER_BUNDLE_SCHEMA_VERSION, APP_SERVER_CLI_VERSION, APP_SERVER_CORE_VERSION,
  appServerAuthPackageName, appServerRuntimePackageName, appServerRuntimeTarget, resolveBundledAppServerRuntime, type BundledAppServerRuntime,
} from "@codem/app-server"

const samplesIndex = process.argv.indexOf("--samples")
const samples = samplesIndex < 0 ? 7 : Number(process.argv[samplesIndex + 1])
if (!Number.isInteger(samples) || samples < 1) throw new Error("Pass --samples <positive integer>")
const built = fileURLToPath(new URL("..", import.meta.url))
const real = existsSync(join(built, APP_SERVER_BUNDLE_DIRECTORY, APP_SERVER_BUNDLE_MANIFEST))
const extensionRoot = real ? built : await generatedBundle()

interface Sample { wallMs: number; maxBlockedMs: number; turns: number }

/** Runs `work` while a 1 ms timer records the longest gap between its callbacks. */
async function sample(work: () => Promise<unknown> | unknown): Promise<Sample> {
  await new Promise(resolve => setTimeout(resolve, 5))
  let last = performance.now(), longest = 0, turns = 0
  const timer = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; turns++ }, 1)
  const started = performance.now()
  await work()
  const wallMs = performance.now() - started
  longest = Math.max(longest, performance.now() - last)
  clearInterval(timer)
  return { wallMs, maxBlockedMs: longest, turns }
}

async function measure(name: string, work: () => Promise<unknown> | unknown): Promise<void> {
  const results: Sample[] = []
  for (let index = 0; index < samples; index++) results.push(await sample(work))
  const median = (key: keyof Sample) => Number(results.map(result => result[key]).sort((a, b) => a - b)[Math.floor(results.length / 2)]!.toFixed(1))
  console.log(JSON.stringify({ name, samples, medianWallMs: median("wallMs"), medianMaxBlockedMs: median("maxBlockedMs"), worstMaxBlockedMs: Number(Math.max(...results.map(result => result.maxBlockedMs)).toFixed(1)), medianTimerTurns: median("turns") }))
}

try {
  const runtime = await resolveBundledAppServerRuntime({ extensionRoot })
  const bytes = [runtime.executablePath, runtime.authExecutablePath].map(path => readFileSync(path).length)
  console.log(JSON.stringify({ node: process.version, bundle: real ? "apps/vscode build" : "generated", coreBytes: bytes[0], authBytes: bytes[1] }))
  // What the synchronous implementation did per verification: read each file whole, then hash it.
  await measure("synchronous read and hash (previous)", () => syncDigests(runtime))
  await measure("resolveBundledAppServerRuntime", () => resolveBundledAppServerRuntime({ extensionRoot }))
  // Manifest read, stat and access checks still run synchronously before the first await.
  const prologue: number[] = []
  for (let index = 0; index < samples; index++) {
    const started = performance.now()
    const pending = resolveBundledAppServerRuntime({ extensionRoot })
    prologue.push(performance.now() - started)
    await pending
  }
  console.log(JSON.stringify({ name: "synchronous prologue before the first await", samples, medianMs: Number(prologue.sort((a, b) => a - b)[Math.floor(samples / 2)]!.toFixed(3)) }))
} finally {
  if (!real) await rm(extensionRoot, { recursive: true, force: true })
}

function syncDigests(runtime: BundledAppServerRuntime): string[] {
  return [runtime.executablePath, runtime.authExecutablePath].map(path => createHash("sha256").update(readFileSync(path)).digest("hex"))
}

async function generatedBundle(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codem-integrity-benchmark-"))
  const directory = join(root, APP_SERVER_BUNDLE_DIRECTORY)
  await mkdir(directory, { recursive: true })
  const target = appServerRuntimeTarget(process.platform, process.arch)
  const windows = process.platform === "win32"
  const files = { core: windows ? "codem-core.exe" : "codem-core", auth: windows ? "codem-auth.exe" : "codem-auth" }
  const digests: Record<string, string> = {}
  for (const [key, name, size] of [["core", files.core, 13_106_384], ["auth", files.auth, 76_837_346]] as const) {
    const content = Buffer.alloc(size, key === "core" ? 1 : 2)
    await writeFile(join(directory, name), content)
    await chmod(join(directory, name), 0o755)
    digests[key] = createHash("sha256").update(content).digest("hex")
  }
  await writeFile(join(directory, "LICENSE.core"), "benchmark\n")
  await writeFile(join(directory, "LICENSE.auth"), "benchmark\n")
  await writeFile(join(directory, APP_SERVER_BUNDLE_MANIFEST), JSON.stringify({
    schemaVersion: APP_SERVER_BUNDLE_SCHEMA_VERSION, target, packageName: appServerRuntimePackageName(target), coreVersion: APP_SERVER_CORE_VERSION,
    executableName: files.core, sha256: digests.core, authPackageName: appServerAuthPackageName(target), cliVersion: APP_SERVER_CLI_VERSION,
    authExecutableName: files.auth, authSha256: digests.auth,
  }))
  return root
}
