import { accessSync, constants, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join } from "node:path"

export const APP_SERVER_CORE_VERSION = "0.8.44"
export const APP_SERVER_CLI_VERSION = "0.1.208"

const CORE_PACKAGE = "@lark-codem/codem-core"
const CLI_PACKAGE = "@lark-codem/codem-cli"

const TARGETS = {
  "darwin-arm64": {
    packageName: "@lark-codem/codem-core-darwin-arm64",
    executableName: "codem-core",
    authPackageName: "@lark-codem/codem-cli-darwin-arm64",
    authExecutableName: join("bin", "codem"),
  },
  "darwin-x64": {
    packageName: "@lark-codem/codem-core-darwin-x64",
    executableName: "codem-core",
    authPackageName: "@lark-codem/codem-cli-darwin-x64",
    authExecutableName: join("bin", "codem"),
  },
  "linux-arm64": {
    packageName: "@lark-codem/codem-core-linux-arm64-gnu",
    executableName: "codem-core",
    authPackageName: "@lark-codem/codem-cli-linux-arm64",
    authExecutableName: join("bin", "codem"),
  },
  "linux-x64": {
    packageName: "@lark-codem/codem-core-linux-x64-gnu",
    executableName: "codem-core",
    authPackageName: "@lark-codem/codem-cli-linux-x64",
    authExecutableName: join("bin", "codem"),
  },
  "win32-arm64": {
    packageName: "@lark-codem/codem-core-win32-arm64-gnu",
    executableName: "codem-core.exe",
    authPackageName: "@lark-codem/codem-cli-win32-arm64",
    authExecutableName: join("bin", "codem.exe"),
  },
  "win32-x64": {
    packageName: "@lark-codem/codem-core-win32-x64-msvc",
    executableName: "codem-core.exe",
    authPackageName: "@lark-codem/codem-cli-win32-x64",
    authExecutableName: join("bin", "codem.exe"),
  },
} as const

export type AppServerRuntimeTarget = keyof typeof TARGETS

export interface ResolveAppServerRuntimeOptions {
  readonly packageRoot: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}

export interface AppServerRuntime {
  readonly target: AppServerRuntimeTarget
  readonly packageName: string
  readonly coreVersion: string
  readonly executablePath: string
  readonly licensePath: string
  readonly authPackageName: string
  readonly cliVersion: string
  readonly authExecutablePath: string
  readonly authLicensePath: string
}

export function resolveAppServerRuntime(options: ResolveAppServerRuntimeOptions): AppServerRuntime {
  if (!isAbsolute(options.packageRoot)) {
    throw new Error(`CodeM App Server packageRoot must be absolute: ${options.packageRoot}`)
  }

  const platform = options.platform ?? process.platform
  const target = appServerRuntimeTarget(platform, options.arch ?? process.arch)

  const packageRequire = createRequire(join(options.packageRoot, "package.json"))
  const coreManifestPath = resolveManifest(packageRequire, CORE_PACKAGE)
  const coreManifest = readManifest(coreManifestPath, CORE_PACKAGE)
  requireVersion(coreManifest.version, CORE_PACKAGE, APP_SERVER_CORE_VERSION)

  const cliManifestPath = resolveManifest(packageRequire, CLI_PACKAGE)
  const cliManifest = readManifest(cliManifestPath, CLI_PACKAGE)
  requireVersion(cliManifest.version, CLI_PACKAGE, APP_SERVER_CLI_VERSION)

  const selected = TARGETS[target]
  const platformRequire = createRequire(coreManifestPath)
  const platformManifestPath = resolveManifest(platformRequire, selected.packageName)
  const platformManifest = readManifest(platformManifestPath, selected.packageName)
  requireVersion(platformManifest.version, selected.packageName, APP_SERVER_CORE_VERSION)

  const executablePath = join(dirname(platformManifestPath), selected.executableName)
  assertExecutable(executablePath, platform)
  const licensePath = join(dirname(platformManifestPath), "LICENSE")
  assertRegularFile(licensePath, "license")

  const authPlatformRequire = createRequire(cliManifestPath)
  const authManifestPath = resolveManifest(authPlatformRequire, selected.authPackageName)
  const authManifest = readManifest(authManifestPath, selected.authPackageName)
  requireVersion(authManifest.version, selected.authPackageName, APP_SERVER_CLI_VERSION)
  const authExecutablePath = join(dirname(authManifestPath), selected.authExecutableName)
  assertExecutable(authExecutablePath, platform)
  const authLicensePath = join(dirname(authManifestPath), "LICENSE")
  assertRegularFile(authLicensePath, "authentication license")
  return {
    target,
    packageName: selected.packageName,
    coreVersion: platformManifest.version,
    executablePath,
    licensePath,
    authPackageName: selected.authPackageName,
    cliVersion: authManifest.version,
    authExecutablePath,
    authLicensePath,
  }
}

export function appServerRuntimeTarget(platform: NodeJS.Platform, arch: string): AppServerRuntimeTarget {
  const target = `${platform}-${arch}`
  if (!isAppServerRuntimeTarget(target)) {
    throw new Error(`CodeM App Server does not support ${target}; expected ${Object.keys(TARGETS).join(", ")}`)
  }
  return target
}

export function appServerRuntimePackageName(target: AppServerRuntimeTarget): string {
  return TARGETS[target].packageName
}

export function appServerAuthPackageName(target: AppServerRuntimeTarget): string {
  return TARGETS[target].authPackageName
}

function isAppServerRuntimeTarget(value: string): value is AppServerRuntimeTarget {
  return Object.hasOwn(TARGETS, value)
}

function resolveManifest(resolver: NodeJS.Require, packageName: string): string {
  try {
    return resolver.resolve(`${packageName}/package.json`)
  } catch (error: unknown) {
    throw new Error(`Cannot resolve CodeM App Server package ${packageName}`, { cause: error })
  }
}

function readManifest(path: string, packageName: string): { readonly version: string } {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error: unknown) {
    throw new Error(`Cannot read CodeM App Server package manifest ${path}`, { cause: error })
  }
  if (!isObject(value) || typeof value.version !== "string" || !value.version.trim()) {
    throw new Error(`CodeM App Server package ${packageName} has no version in ${path}`)
  }
  return { version: value.version }
}

function requireVersion(actual: string | undefined, packageName: string, expected: string): void {
  if (actual === expected) return
  throw new Error(`CodeM App Server requires ${packageName}@${expected}, resolved ${actual}`)
}

function assertExecutable(path: string, platform: NodeJS.Platform): void {
  assertRegularFile(path, "executable")
  if (platform === "win32") return
  try {
    accessSync(path, constants.X_OK)
  } catch (error: unknown) {
    throw new Error(`CodeM App Server executable is not executable: ${path}`, { cause: error })
  }
}

function assertRegularFile(path: string, label: string): void {
  let stats
  try {
    stats = statSync(path)
  } catch (error: unknown) {
    throw new Error(`CodeM App Server ${label} is missing: ${path}`, { cause: error })
  }
  if (!stats.isFile()) {
    throw new Error(`CodeM App Server ${label} is not a regular file: ${path}`)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
