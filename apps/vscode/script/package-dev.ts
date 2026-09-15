#!/usr/bin/env bun
import { $ } from "bun"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { appServerRuntimeTarget } from "@codem/app-server"
import manifest from "../package.json"

const extensionRoot = join(import.meta.dir, "..")
const repositoryRoot = join(extensionRoot, "..", "..")
const outputDirectory = join(repositoryRoot, "out")
const target = appServerRuntimeTarget(process.platform, process.arch)
const outputPath = join(outputDirectory, `codem-vscode-${manifest.version}-dev-${target}.vsix`)

mkdirSync(outputDirectory, { recursive: true })

await $`pnpm exec vsce package --no-dependencies --skip-license --target ${target} -o ${outputPath}`.cwd(extensionRoot)

console.log(`Created ${outputPath}`)
