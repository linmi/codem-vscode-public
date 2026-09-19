#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { appServerRuntimeTarget } from "@codem/app-server"
import { extensionRoot, run } from "./node-run.ts"

const root = extensionRoot()
const repositoryRoot = join(root, "..", "..")
const outputDirectory = join(repositoryRoot, "out")
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }
const target = appServerRuntimeTarget(process.platform, process.arch)
const outputPath = join(outputDirectory, `codem-vscode-${manifest.version}-dev-${target}.vsix`)

mkdirSync(outputDirectory, { recursive: true })
run("pnpm", ["exec", "vsce", "package", "--no-dependencies", "--skip-license", "--target", target, "-o", outputPath], {
  cwd: root,
})
console.log(`Created ${outputPath}`)
