#!/usr/bin/env bun
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { stageAppServerRuntime } from "@codem/app-server/build"

const extensionRoot = join(import.meta.dir, "..")
const require = createRequire(import.meta.url)
const appServerEntry = require.resolve("@codem/app-server")
const packageRoot = join(dirname(appServerEntry), "..")

const runtime = stageAppServerRuntime({ packageRoot, extensionRoot })

console.log(`Prepared CodeM App Server ${runtime.coreVersion} for ${runtime.target}`)
console.log(`  executable: ${runtime.executablePath}`)
console.log(`  sha256: ${runtime.sha256}`)
console.log(`Prepared CodeM authentication broker ${runtime.cliVersion}`)
console.log(`  executable: ${runtime.authExecutablePath}`)
console.log(`  sha256: ${runtime.authSha256}`)
