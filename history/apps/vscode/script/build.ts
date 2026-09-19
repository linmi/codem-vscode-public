#!/usr/bin/env bun
import { $ } from "bun"
import { dirname, join } from "node:path"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { appServerRuntimeTarget } from "@codem/app-server"
import { stageAppServerRuntime } from "@codem/app-server/build"

const packageJsonPath = join(import.meta.dir, "..", "package.json")
const packageJson = await Bun.file(packageJsonPath).json()
const version = process.env.KILO_VERSION ? process.env.KILO_VERSION : packageJson.version
const prerelease = process.env.KILO_PRE_RELEASE === "true"

console.log(`Building VSCode extension version: ${version}${prerelease ? " (pre-release)" : ""}`)

if (packageJson.version !== version) {
  console.log(`Updating package.json version from ${packageJson.version} to ${version}`)
  packageJson.version = version
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")
}

const extensionRoot = join(import.meta.dir, "..")
const require = createRequire(import.meta.url)
const appServerPackageRoot = join(dirname(require.resolve("@codem/app-server")), "..")

const targets = [
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "win32", arch: "x64" },
  { platform: "win32", arch: "arm64" },
] as const

const binDir = join(import.meta.dir, "..", "bin")
const distDir = join(import.meta.dir, "..", "dist")
const outDir = join(import.meta.dir, "..", "out")

console.log("\n🧹 Cleaning up directories...")
for (const dir of [binDir, distDir, outDir]) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
    console.log(`  ✓ Cleaned ${dir}`)
  }
}

mkdirSync(outDir, { recursive: true })
mkdirSync(distDir, { recursive: true })

console.log("\n🔄 Rebuilding SDK types (ensures dist/ is in sync with server API)...")
await $`bun run --cwd ${join(import.meta.dir, "..", "..", "..", "packages", "sdk", "js")} build`

console.log("\n📦 Compiling extension...")
await $`bun run check-types`
await $`bun run lint`
await $`node ${join(import.meta.dir, "..", "esbuild.js")} --production`

for (const config of targets) {
  const target = appServerRuntimeTarget(config.platform, config.arch)
  console.log(`\n🎯 Processing target: ${target}`)

  if (existsSync(binDir)) {
    rmSync(binDir, { recursive: true, force: true })
  }
  mkdirSync(binDir, { recursive: true })

  const runtime = stageAppServerRuntime({
    packageRoot: appServerPackageRoot,
    extensionRoot,
    platform: config.platform,
    arch: config.arch,
  })
  console.log(`  ✅ CodeM Core ${runtime.coreVersion} and credential broker ${runtime.cliVersion} ready`)

  console.log(`  📦 Packaging .vsix for ${target}${prerelease ? " (pre-release)" : ""}...`)
  const vsixPath = join(outDir, `codem-vscode-${target}.vsix`)
  const args = ["--no-dependencies", "--skip-license", "--target", target, "-o", vsixPath]
  if (prerelease) args.push("--pre-release")
  await $`vsce package ${args}`.env({
    ...process.env,
    npm_config_ignore_scripts: "true",
  })
  console.log(`  ✅ Created ${vsixPath}`)
}

console.log("\n✨ All VSIX packages built successfully!")
