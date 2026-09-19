#!/usr/bin/env node
import { existsSync } from "node:fs"
import { join } from "node:path"
import { extensionRoot } from "./node-run.ts"

const root = extensionRoot()
const sdk = join(root, "..", "..", "packages", "sdk", "js")
const types = join(sdk, "src", "v2", "client.ts")

if (!existsSync(types)) {
  throw new Error(`Frozen leftover SDK types missing: ${types}`)
}

console.log("[prepare-sdk] leftover @kilocode/sdk types are frozen; skip OpenAPI rebuild")
