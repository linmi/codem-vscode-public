import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, isAbsolute, join } from "node:path"
import { sha256File } from "./fileDigest.ts"
import {
  APP_SERVER_CLI_VERSION,
  APP_SERVER_CORE_VERSION,
  appServerAuthPackageName,
  appServerRuntimePackageName,
  appServerRuntimeTarget,
  resolveAppServerRuntime,
  type AppServerRuntime,
  type AppServerRuntimeTarget,
} from "./runtime.ts"

export const APP_SERVER_BUNDLE_SCHEMA_VERSION = 2
export const APP_SERVER_BUNDLE_DIRECTORY = join("bin", "app-server")
export const APP_SERVER_BUNDLE_MANIFEST = "runtime.json"

export interface AppServerBundleManifest {
  readonly schemaVersion: typeof APP_SERVER_BUNDLE_SCHEMA_VERSION
  readonly target: AppServerRuntimeTarget
  readonly packageName: string
  readonly coreVersion: string
  readonly executableName: string
  readonly sha256: string
  readonly authPackageName: string
  readonly cliVersion: string
  readonly authExecutableName: string
  readonly authSha256: string
}

export interface BundledAppServerRuntime extends AppServerRuntime {
  readonly sha256: string
  readonly authSha256: string
}

export interface StageAppServerRuntimeOptions {
  readonly packageRoot: string
  readonly extensionRoot: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}

export interface ResolveBundledAppServerRuntimeOptions {
  readonly extensionRoot: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}

export async function stageAppServerRuntime(options: StageAppServerRuntimeOptions): Promise<BundledAppServerRuntime> {
  requireAbsoluteExtensionRoot(options.extensionRoot)
  const platform = options.platform ?? process.platform
  const runtime = resolveAppServerRuntime({
    packageRoot: options.packageRoot,
    platform,
    arch: options.arch,
  })
  const bundleDirectory = join(options.extensionRoot, APP_SERVER_BUNDLE_DIRECTORY)

  rmSync(bundleDirectory, { recursive: true, force: true })
  mkdirSync(bundleDirectory, { recursive: true })

  const executableName = basename(runtime.executablePath)
  const executablePath = join(bundleDirectory, executableName)
  const authExecutableName = platform === "win32" ? "codem-auth.exe" : "codem-auth"
  const authExecutablePath = join(bundleDirectory, authExecutableName)
  copyFileSync(runtime.executablePath, executablePath)
  copyFileSync(runtime.licensePath, join(bundleDirectory, "LICENSE.core"))
  copyFileSync(runtime.authExecutablePath, authExecutablePath)
  copyFileSync(runtime.authLicensePath, join(bundleDirectory, "LICENSE.auth"))
  if (platform !== "win32") chmodSync(executablePath, 0o755)
  if (platform !== "win32") chmodSync(authExecutablePath, 0o755)

  const manifest: AppServerBundleManifest = {
    schemaVersion: APP_SERVER_BUNDLE_SCHEMA_VERSION,
    target: runtime.target,
    packageName: runtime.packageName,
    coreVersion: runtime.coreVersion,
    executableName,
    sha256: await sha256File(executablePath),
    authPackageName: runtime.authPackageName,
    cliVersion: runtime.cliVersion,
    authExecutableName,
    authSha256: await sha256File(authExecutablePath),
  }
  writeFileSync(join(bundleDirectory, APP_SERVER_BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)

  return resolveBundledAppServerRuntime({
    extensionRoot: options.extensionRoot,
    platform,
    arch: options.arch,
  })
}

export async function resolveBundledAppServerRuntime(
  options: ResolveBundledAppServerRuntimeOptions,
): Promise<BundledAppServerRuntime> {
  requireAbsoluteExtensionRoot(options.extensionRoot)
  const platform = options.platform ?? process.platform
  const expectedTarget = appServerRuntimeTarget(platform, options.arch ?? process.arch)
  const bundleDirectory = join(options.extensionRoot, APP_SERVER_BUNDLE_DIRECTORY)
  const manifestPath = join(bundleDirectory, APP_SERVER_BUNDLE_MANIFEST)
  const manifest = readManifest(manifestPath)

  if (manifest.schemaVersion !== APP_SERVER_BUNDLE_SCHEMA_VERSION) {
    throw new Error(
      `CodeM App Server bundle schema ${String(manifest.schemaVersion)} is not supported; expected ${APP_SERVER_BUNDLE_SCHEMA_VERSION}`,
    )
  }
  if (manifest.target !== expectedTarget) {
    throw new Error(`CodeM App Server bundle targets ${manifest.target}; this host requires ${expectedTarget}`)
  }
  if (manifest.coreVersion !== APP_SERVER_CORE_VERSION) {
    throw new Error(
      `CodeM App Server bundle contains Core ${manifest.coreVersion}; expected ${APP_SERVER_CORE_VERSION}`,
    )
  }
  if (manifest.cliVersion !== APP_SERVER_CLI_VERSION) {
    throw new Error(`CodeM App Server bundle contains CLI ${manifest.cliVersion}; expected ${APP_SERVER_CLI_VERSION}`)
  }
  const expectedPackageName = appServerRuntimePackageName(expectedTarget)
  if (manifest.packageName !== expectedPackageName) {
    throw new Error(`CodeM App Server bundle package is ${manifest.packageName}; expected ${expectedPackageName}`)
  }
  const expectedAuthPackageName = appServerAuthPackageName(expectedTarget)
  if (manifest.authPackageName !== expectedAuthPackageName) {
    throw new Error(
      `CodeM App Server auth bundle package is ${manifest.authPackageName}; expected ${expectedAuthPackageName}`,
    )
  }

  const expectedExecutableName = platform === "win32" ? "codem-core.exe" : "codem-core"
  if (manifest.executableName !== expectedExecutableName) {
    throw new Error(
      `CodeM App Server bundle executable is ${manifest.executableName}; expected ${expectedExecutableName}`,
    )
  }
  if (!/^[a-f0-9]{64}$/u.test(manifest.sha256)) {
    throw new Error(`CodeM App Server bundle manifest has an invalid SHA-256: ${manifestPath}`)
  }
  const expectedAuthExecutableName = platform === "win32" ? "codem-auth.exe" : "codem-auth"
  if (manifest.authExecutableName !== expectedAuthExecutableName) {
    throw new Error(
      `CodeM App Server auth bundle executable is ${manifest.authExecutableName}; expected ${expectedAuthExecutableName}`,
    )
  }
  if (!/^[a-f0-9]{64}$/u.test(manifest.authSha256)) {
    throw new Error(`CodeM App Server auth bundle manifest has an invalid SHA-256: ${manifestPath}`)
  }

  const executablePath = join(bundleDirectory, expectedExecutableName)
  assertRegularFile(executablePath, "executable")
  if (platform !== "win32") assertExecutable(executablePath)
  const licensePath = join(bundleDirectory, "LICENSE.core")
  assertRegularFile(licensePath, "license")

  const authExecutablePath = join(bundleDirectory, expectedAuthExecutableName)
  assertRegularFile(authExecutablePath, "authentication executable")
  if (platform !== "win32") assertExecutable(authExecutablePath)
  const authLicensePath = join(bundleDirectory, "LICENSE.auth")
  assertRegularFile(authLicensePath, "authentication license")

  const actualSha256 = await sha256File(executablePath)
  if (actualSha256 !== manifest.sha256) {
    throw new Error(
      `CodeM App Server bundle SHA-256 mismatch for ${executablePath}; expected ${manifest.sha256}, received ${actualSha256}`,
    )
  }
  const actualAuthSha256 = await sha256File(authExecutablePath)
  if (actualAuthSha256 !== manifest.authSha256) {
    throw new Error(
      `CodeM App Server auth bundle SHA-256 mismatch for ${authExecutablePath}; expected ${manifest.authSha256}, received ${actualAuthSha256}`,
    )
  }

  return {
    target: manifest.target,
    packageName: manifest.packageName,
    coreVersion: manifest.coreVersion,
    executablePath,
    licensePath,
    sha256: actualSha256,
    authPackageName: manifest.authPackageName,
    cliVersion: manifest.cliVersion,
    authExecutablePath,
    authLicensePath,
    authSha256: actualAuthSha256,
  }
}

function readManifest(path: string): AppServerBundleManifest {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error: unknown) {
    throw new Error(`Cannot read CodeM App Server bundle manifest ${path}`, { cause: error })
  }
  if (!isObject(value)) {
    throw new Error(`CodeM App Server bundle manifest must be an object: ${path}`)
  }
  const {
    schemaVersion,
    target,
    packageName,
    coreVersion,
    executableName,
    sha256: digest,
    authPackageName,
    cliVersion,
    authExecutableName,
    authSha256,
  } = value
  if (
    typeof schemaVersion !== "number" ||
    typeof target !== "string" ||
    typeof packageName !== "string" ||
    typeof coreVersion !== "string" ||
    typeof executableName !== "string" ||
    typeof digest !== "string" ||
    typeof authPackageName !== "string" ||
    typeof cliVersion !== "string" ||
    typeof authExecutableName !== "string" ||
    typeof authSha256 !== "string"
  ) {
    throw new Error(`CodeM App Server bundle manifest has invalid fields: ${path}`)
  }
  return {
    schemaVersion: schemaVersion as typeof APP_SERVER_BUNDLE_SCHEMA_VERSION,
    target: target as AppServerRuntimeTarget,
    packageName,
    coreVersion,
    executableName,
    sha256: digest,
    authPackageName,
    cliVersion,
    authExecutableName,
    authSha256,
  }
}

function requireAbsoluteExtensionRoot(extensionRoot: string): void {
  if (!isAbsolute(extensionRoot)) {
    throw new Error(`CodeM extensionRoot must be absolute: ${extensionRoot}`)
  }
  if (dirname(extensionRoot) === extensionRoot) {
    throw new Error(`CodeM extensionRoot cannot be a filesystem root: ${extensionRoot}`)
  }
}

function assertRegularFile(path: string, label: string): void {
  let stats
  try {
    stats = statSync(path)
  } catch (error: unknown) {
    throw new Error(`CodeM App Server bundled ${label} is missing: ${path}`, { cause: error })
  }
  if (!stats.isFile()) throw new Error(`CodeM App Server bundled ${label} is not a regular file: ${path}`)
}

function assertExecutable(path: string): void {
  try {
    accessSync(path, constants.X_OK)
  } catch (error: unknown) {
    throw new Error(`CodeM App Server bundled executable is not executable: ${path}`, { cause: error })
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
