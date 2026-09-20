import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { createVSIX } from "@vscode/vsce"
import { packageTarget, stageVsix } from "./support/vsixPackage.ts"

const { values } = parseArgs({ options: { target: { type: "string" } }, allowPositionals: false })
const target = packageTarget(values.target)
const root = fileURLToPath(new URL("..", import.meta.url))
const output = resolve(root, "../../dist/vsix")
// Always build once; stale files from watch or another platform cannot become a release package.
await import("./build.ts")
await mkdir(output, { recursive: true })
const temporary = await mkdtemp(join(output, ".staging-"))
try {
  const staging = join(temporary, "extension")
  const name = await stageVsix(root, staging, target)
  const archive = join(temporary, name)
  await createVSIX({ cwd: staging, packagePath: archive, target, dependencies: false })
  const digest = createHash("sha256").update(await readFile(archive)).digest("hex")
  await rename(archive, join(output, name))
  await writeFile(join(output, `${name}.sha256`), `${digest}  ${name}\n`)
  console.log(`VSIX ready: ${join(output, name)}`)
} finally { await rm(temporary, { recursive: true, force: true }) }
