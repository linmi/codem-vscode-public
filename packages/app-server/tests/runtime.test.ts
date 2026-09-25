import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, it } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import {
  APP_SERVER_CLI_VERSION,
  APP_SERVER_CORE_VERSION,
  createBundledAppServerRuntimeResolver,
  resolveBundledAppServerRuntime,
  resolveAppServerRuntime,
  type BundledAppServerRuntimeVerification,
} from "../src/index.ts"
import { stageAppServerRuntime } from "../src/bundle.ts"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("App Server runtime", () => {
  it("resolves the exact platform package and executable", () => {
    const fixture = createRuntimeFixture()
    assert.deepEqual(resolveAppServerRuntime({ packageRoot: fixture.root, platform: "darwin", arch: "arm64" }), {
      target: "darwin-arm64",
      packageName: "@lark-codem/codem-core-darwin-arm64",
      coreVersion: APP_SERVER_CORE_VERSION,
      executablePath: fixture.executablePath,
      licensePath: fixture.licensePath,
      authPackageName: "@lark-codem/codem-cli-darwin-arm64",
      cliVersion: APP_SERVER_CLI_VERSION,
      authExecutablePath: fixture.authExecutablePath,
      authLicensePath: fixture.authLicensePath,
    })
  })

  it("rejects unsupported targets", () => {
    const fixture = createRuntimeFixture()
    assert.throws(
      () => resolveAppServerRuntime({ packageRoot: fixture.root, platform: "freebsd", arch: "x64" }),
      /does not support freebsd-x64/u,
    )
  })

  it("rejects a platform package whose version differs from the pin", () => {
    const fixture = createRuntimeFixture({ platformVersion: "0.8.45" })
    assert.throws(
      () => resolveAppServerRuntime({ packageRoot: fixture.root, platform: "darwin", arch: "arm64" }),
      { message: `CodeM App Server requires @lark-codem/codem-core-darwin-arm64@${APP_SERVER_CORE_VERSION}, resolved 0.8.45` },
    )
  })

  it("rejects an online Core meta package whose version differs from the pin", () => {
    const fixture = createRuntimeFixture({ coreVersion: "0.8.45" })
    assert.throws(
      () => resolveAppServerRuntime({ packageRoot: fixture.root, platform: "darwin", arch: "arm64" }),
      { message: `CodeM App Server requires @lark-codem/codem-core@${APP_SERVER_CORE_VERSION}, resolved 0.8.45` },
    )
  })

  it("rejects an authentication CLI platform package whose version differs from the pin", () => {
    const fixture = createRuntimeFixture({ authPlatformVersion: "0.1.207" })
    assert.throws(
      () => resolveAppServerRuntime({ packageRoot: fixture.root, platform: "darwin", arch: "arm64" }),
      /requires @lark-codem\/codem-cli-darwin-arm64@0\.1\.208, resolved 0\.1\.207/u,
    )
  })
})

describe("bundled App Server runtime", () => {
  it("stages and resolves a self-contained runtime", async () => {
    const fixture = createRuntimeFixture()
    const extensionRoot = createTemporaryDirectory("codem-extension-")
    const runtime = await stageAppServerRuntime({
      packageRoot: fixture.root,
      extensionRoot,
      platform: "darwin",
      arch: "arm64",
    })

    assert.deepEqual(await resolveBundledAppServerRuntime({ extensionRoot, platform: "darwin", arch: "arm64" }), runtime)
    assert.equal(readFileSync(runtime.executablePath, "utf8"), readFileSync(fixture.executablePath, "utf8"))
    assert.equal(readFileSync(runtime.licensePath, "utf8"), "fixture license\n")
    assert.equal(readFileSync(runtime.authExecutablePath, "utf8"), readFileSync(fixture.authExecutablePath, "utf8"))
    assert.equal(readFileSync(runtime.authLicensePath, "utf8"), "fixture auth license\n")
    assert.match(runtime.sha256, /^[a-f0-9]{64}$/u)
    assert.match(runtime.authSha256, /^[a-f0-9]{64}$/u)
  })

  it("rejects a bundled executable whose content no longer matches the manifest", async () => {
    const fixture = createRuntimeFixture()
    const extensionRoot = createTemporaryDirectory("codem-extension-")
    const runtime = await stageAppServerRuntime({
      packageRoot: fixture.root,
      extensionRoot,
      platform: "darwin",
      arch: "arm64",
    })
    writeFileSync(runtime.executablePath, "tampered")

    await assert.rejects(
      resolveBundledAppServerRuntime({ extensionRoot, platform: "darwin", arch: "arm64" }),
      /bundle SHA-256 mismatch/u,
    )
  })

  it("rejects a bundled authentication executable whose content no longer matches the manifest", async () => {
    const fixture = createRuntimeFixture()
    const extensionRoot = createTemporaryDirectory("codem-extension-")
    const runtime = await stageAppServerRuntime({
      packageRoot: fixture.root,
      extensionRoot,
      platform: "darwin",
      arch: "arm64",
    })
    writeFileSync(runtime.authExecutablePath, "tampered")

    await assert.rejects(
      resolveBundledAppServerRuntime({ extensionRoot, platform: "darwin", arch: "arm64" }),
      /auth bundle SHA-256 mismatch/u,
    )
  })

  it("keeps the event loop running while it hashes a large executable, then still rejects tampering", async () => {
    const fixture = createRuntimeFixture()
    // Realistic size: the pinned Core is ~13 MB and the authentication CLI ~77 MB.
    writeFileSync(fixture.executablePath, Buffer.alloc(32 * 1024 * 1024, 7))
    const extensionRoot = createTemporaryDirectory("codem-extension-")
    const options = { extensionRoot, platform: "darwin" as const, arch: "arm64" }
    const runtime = await stageAppServerRuntime({ ...options, packageRoot: fixture.root })

    // Timers queued after verification starts must run before it settles. A synchronous
    // read-and-hash settles first and lets none of them run.
    const turns = countEventLoopTurns()
    let settledAfterTurns = -1
    const verification = Promise.resolve(resolveBundledAppServerRuntime(options)).then(result => { settledAfterTurns = turns.count; return result })
    assert.deepEqual(await verification, runtime)
    turns.stop()
    assert.ok(settledAfterTurns >= 8, `verification settled after ${settledAfterTurns} event-loop turns`)

    const tampered = readFileSync(runtime.executablePath)
    tampered[tampered.length - 1] = 8
    writeFileSync(runtime.executablePath, tampered)
    await assert.rejects(resolveBundledAppServerRuntime(options), /bundle SHA-256 mismatch/u)
  })

  it("reuses digests only while an executable keeps its identity, and still rejects a same-size rewrite", async () => {
    const fixture = createRuntimeFixture()
    const extensionRoot = createTemporaryDirectory("codem-extension-")
    const options = { extensionRoot, platform: "darwin" as const, arch: "arm64" }
    const runtime = await stageAppServerRuntime({ ...options, packageRoot: fixture.root })
    // Whole seconds are restored exactly by utimes, so after the rewrite below only ctime differs.
    const mtime = 1_700_000_000
    for (const path of [runtime.executablePath, runtime.authExecutablePath]) utimesSync(path, mtime, mtime)
    await sleep(2_100) // Let the last change leave the 2 s timestamp window.

    const verifications: BundledAppServerRuntimeVerification[] = []
    const resolve = createBundledAppServerRuntimeResolver({ ...options, observe: verification => verifications.push(verification) })
    assert.deepEqual(await resolve(), runtime)
    assert.deepEqual(await resolve(), runtime)
    assert.deepEqual(verifications.map(({ hashed, reused }) => ({ hashed, reused })), [{ hashed: 2, reused: 0 }, { hashed: 0, reused: 2 }])
    await createBundledAppServerRuntimeResolver({ ...options, observe: verification => verifications.push(verification) })()
    assert.deepEqual(verifications.slice(2).map(({ hashed }) => hashed), [2], "another resolver does not share digests")

    const tampered = readFileSync(runtime.executablePath)
    tampered[0] = tampered[0]! ^ 1
    writeFileSync(runtime.executablePath, tampered)
    utimesSync(runtime.executablePath, mtime, mtime)
    await assert.rejects(resolve(), /bundle SHA-256 mismatch/u)
    await assert.rejects(resolve(), /bundle SHA-256 mismatch/u)
    assert.equal(verifications.length, 3, "failed verifications are not reported as verified")
  })

  it("does not reuse the digest of an executable changed within the timestamp window", async () => {
    const fixture = createRuntimeFixture()
    const extensionRoot = createTemporaryDirectory("codem-extension-")
    const options = { extensionRoot, platform: "darwin" as const, arch: "arm64" }
    await stageAppServerRuntime({ ...options, packageRoot: fixture.root })

    const verifications: BundledAppServerRuntimeVerification[] = []
    const resolve = createBundledAppServerRuntimeResolver({ ...options, observe: verification => verifications.push(verification) })
    await resolve()
    await resolve()
    assert.deepEqual(verifications.map(({ hashed }) => hashed), [2, 2])
  })
})

for (const arch of ["x64", "arm64"] as const) {
  it(`bundles Windows ${arch} EXEs and rejects wrong architecture, missing files and tampering`, async () => {
    const fixture = createRuntimeFixture({ target: `win32-${arch}` })
    const extensionRoot = createTemporaryDirectory("codem Windows 中文 ")
    const options = { packageRoot: fixture.root, extensionRoot, platform: "win32" as const, arch }
    const runtime = await stageAppServerRuntime(options)
    assert.equal(runtime.target, `win32-${arch}`)
    assert.equal(runtime.executablePath, join(extensionRoot, "bin", "app-server", "codem-core.exe"))
    assert.equal(runtime.authExecutablePath, join(extensionRoot, "bin", "app-server", "codem-auth.exe"))
    assert.deepEqual(await resolveBundledAppServerRuntime(options), runtime)
    await assert.rejects(resolveBundledAppServerRuntime({ ...options, arch: arch === "x64" ? "arm64" : "x64" }), /this host requires/)
    writeFileSync(runtime.authExecutablePath, "tampered")
    await assert.rejects(resolveBundledAppServerRuntime(options), /auth bundle SHA-256 mismatch/)
    await stageAppServerRuntime(options)
    writeFileSync(runtime.executablePath, "tampered")
    await assert.rejects(resolveBundledAppServerRuntime(options), /bundle SHA-256 mismatch/)
    await stageAppServerRuntime(options)
    rmSync(runtime.authExecutablePath)
    await assert.rejects(resolveBundledAppServerRuntime(options), /authentication executable is missing/)
    rmSync(fixture.executablePath)
    assert.throws(() => resolveAppServerRuntime(options), /executable is missing/)
  })
}

function createRuntimeFixture(
  options: {
    readonly target?: "darwin-arm64" | "win32-x64" | "win32-arm64"
    readonly platformVersion?: string
    readonly coreVersion?: string
    readonly authPlatformVersion?: string
  } = {},
): {
  readonly root: string
  readonly executablePath: string
  readonly licensePath: string
  readonly authExecutablePath: string
  readonly authLicensePath: string
} {
  const root = createTemporaryDirectory("codem-app-server-")
  writeJson(join(root, "package.json"), { private: true })

  const target = options.target ?? "darwin-arm64"
  const coreTarget = target === "win32-x64" ? "win32-x64-msvc" : target === "win32-arm64" ? "win32-arm64-gnu" : target
  const windows = target.startsWith("win32-")
  const scope = join(root, "node_modules", "@lark-codem")
  const core = join(scope, "codem-core")
  const platform = join(scope, `codem-core-${coreTarget}`)
  const cli = join(scope, "codem-cli")
  const authPlatform = join(scope, `codem-cli-${target}`)
  mkdirSync(core, { recursive: true })
  mkdirSync(platform, { recursive: true })
  mkdirSync(cli, { recursive: true })
  mkdirSync(authPlatform, { recursive: true })
  writeJson(join(core, "package.json"), {
    name: "@lark-codem/codem-core",
    version: options.coreVersion ?? APP_SERVER_CORE_VERSION,
  })
  writeJson(join(platform, "package.json"), {
    name: `@lark-codem/codem-core-${coreTarget}`,
    version: options.platformVersion ?? APP_SERVER_CORE_VERSION,
  })
  writeJson(join(cli, "package.json"), {
    name: "@lark-codem/codem-cli",
    version: APP_SERVER_CLI_VERSION,
  })
  writeJson(join(authPlatform, "package.json"), {
    name: `@lark-codem/codem-cli-${target}`,
    version: options.authPlatformVersion ?? APP_SERVER_CLI_VERSION,
  })

  const executablePath = join(platform, windows ? "codem-core.exe" : "codem-core")
  writeFileSync(executablePath, "#!/bin/sh\nexit 0\n")
  chmodSync(executablePath, windows ? 0o644 : 0o755)
  const licensePath = join(platform, "LICENSE")
  writeFileSync(licensePath, "fixture license\n")
  const authExecutablePath = join(authPlatform, "bin", windows ? "codem.exe" : "codem")
  mkdirSync(dirname(authExecutablePath), { recursive: true })
  writeFileSync(authExecutablePath, "#!/bin/sh\nexit 0\n")
  chmodSync(authExecutablePath, windows ? 0o644 : 0o755)
  const authLicensePath = join(authPlatform, "LICENSE")
  writeFileSync(authLicensePath, "fixture auth license\n")
  return {
    root,
    executablePath: realpathSync(executablePath),
    licensePath: realpathSync(licensePath),
    authExecutablePath: realpathSync(authExecutablePath),
    authLicensePath: realpathSync(authLicensePath),
  }
}

/** Counts check-phase turns until stopped; each turn needs the event loop to be free. */
function countEventLoopTurns(): { readonly count: number; stop(): void } {
  const state = { count: 0, running: true }
  const turn = () => {
    if (!state.running) return
    state.count++
    setImmediate(turn)
  }
  setImmediate(turn)
  return { get count() { return state.count }, stop() { state.running = false } }
}

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
