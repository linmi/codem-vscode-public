import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, it } from "node:test"
import {
  APP_SERVER_CLI_VERSION,
  APP_SERVER_CORE_VERSION,
  resolveBundledAppServerRuntime,
  resolveAppServerRuntime,
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
    const fixture = createRuntimeFixture({ platformVersion: "0.8.37" })
    assert.throws(
      () => resolveAppServerRuntime({ packageRoot: fixture.root, platform: "darwin", arch: "arm64" }),
      /requires @lark-codem\/codem-core-darwin-arm64@0\.8\.44, resolved 0\.8\.37/u,
    )
  })

  it("rejects an online Core meta package whose version differs from the pin", () => {
    const fixture = createRuntimeFixture({ coreVersion: "0.8.37" })
    assert.throws(
      () => resolveAppServerRuntime({ packageRoot: fixture.root, platform: "darwin", arch: "arm64" }),
      /requires @lark-codem\/codem-core@0\.8\.44, resolved 0\.8\.37/u,
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
  it("stages and resolves a self-contained runtime", () => {
    const fixture = createRuntimeFixture()
    const extensionRoot = createTemporaryDirectory("codem-extension-")
    const runtime = stageAppServerRuntime({
      packageRoot: fixture.root,
      extensionRoot,
      platform: "darwin",
      arch: "arm64",
    })

    assert.deepEqual(resolveBundledAppServerRuntime({ extensionRoot, platform: "darwin", arch: "arm64" }), runtime)
    assert.equal(readFileSync(runtime.executablePath, "utf8"), readFileSync(fixture.executablePath, "utf8"))
    assert.equal(readFileSync(runtime.licensePath, "utf8"), "fixture license\n")
    assert.equal(readFileSync(runtime.authExecutablePath, "utf8"), readFileSync(fixture.authExecutablePath, "utf8"))
    assert.equal(readFileSync(runtime.authLicensePath, "utf8"), "fixture auth license\n")
    assert.match(runtime.sha256, /^[a-f0-9]{64}$/u)
    assert.match(runtime.authSha256, /^[a-f0-9]{64}$/u)
  })

  it("rejects a bundled executable whose content no longer matches the manifest", () => {
    const fixture = createRuntimeFixture()
    const extensionRoot = createTemporaryDirectory("codem-extension-")
    const runtime = stageAppServerRuntime({
      packageRoot: fixture.root,
      extensionRoot,
      platform: "darwin",
      arch: "arm64",
    })
    writeFileSync(runtime.executablePath, "tampered")

    assert.throws(
      () => resolveBundledAppServerRuntime({ extensionRoot, platform: "darwin", arch: "arm64" }),
      /bundle SHA-256 mismatch/u,
    )
  })

  it("rejects a bundled authentication executable whose content no longer matches the manifest", () => {
    const fixture = createRuntimeFixture()
    const extensionRoot = createTemporaryDirectory("codem-extension-")
    const runtime = stageAppServerRuntime({
      packageRoot: fixture.root,
      extensionRoot,
      platform: "darwin",
      arch: "arm64",
    })
    writeFileSync(runtime.authExecutablePath, "tampered")

    assert.throws(
      () => resolveBundledAppServerRuntime({ extensionRoot, platform: "darwin", arch: "arm64" }),
      /auth bundle SHA-256 mismatch/u,
    )
  })
})

function createRuntimeFixture(
  options: {
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

  const scope = join(root, "node_modules", "@lark-codem")
  const core = join(scope, "codem-core")
  const platform = join(scope, "codem-core-darwin-arm64")
  const cli = join(scope, "codem-cli")
  const authPlatform = join(scope, "codem-cli-darwin-arm64")
  mkdirSync(core, { recursive: true })
  mkdirSync(platform, { recursive: true })
  mkdirSync(cli, { recursive: true })
  mkdirSync(authPlatform, { recursive: true })
  writeJson(join(core, "package.json"), {
    name: "@lark-codem/codem-core",
    version: options.coreVersion ?? APP_SERVER_CORE_VERSION,
  })
  writeJson(join(platform, "package.json"), {
    name: "@lark-codem/codem-core-darwin-arm64",
    version: options.platformVersion ?? APP_SERVER_CORE_VERSION,
  })
  writeJson(join(cli, "package.json"), {
    name: "@lark-codem/codem-cli",
    version: APP_SERVER_CLI_VERSION,
  })
  writeJson(join(authPlatform, "package.json"), {
    name: "@lark-codem/codem-cli-darwin-arm64",
    version: options.authPlatformVersion ?? APP_SERVER_CLI_VERSION,
  })

  const executablePath = join(platform, "codem-core")
  writeFileSync(executablePath, "#!/bin/sh\nexit 0\n")
  chmodSync(executablePath, 0o755)
  const licensePath = join(platform, "LICENSE")
  writeFileSync(licensePath, "fixture license\n")
  const authExecutablePath = join(authPlatform, "bin", "codem")
  mkdirSync(dirname(authExecutablePath), { recursive: true })
  writeFileSync(authExecutablePath, "#!/bin/sh\nexit 0\n")
  chmodSync(authExecutablePath, 0o755)
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

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
