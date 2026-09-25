import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { stageAppServerRuntime } from "@codem/app-server/build"

// Development-only: reuse the same pinned binaries, schema and hashes as VS Code.
const require = createRequire(import.meta.url)
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const runtime = await stageAppServerRuntime({
  packageRoot: resolve(dirname(require.resolve("@codem/app-server")), ".."),
  extensionRoot: resolve(app, "build/runtime"),
})
console.log(`CodeM runtime staged: ${runtime.target}, Core ${runtime.coreVersion}, CLI ${runtime.cliVersion}`)
