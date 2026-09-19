import { build, context, type BuildOptions } from "esbuild"
import { stageAppServerRuntime } from "@codem/app-server/build"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const require = createRequire(import.meta.url)
const packageRoot = resolve(dirname(require.resolve("@codem/app-server")), "..")
stageAppServerRuntime({ packageRoot, extensionRoot: root })

const configurations: BuildOptions[] = [
  { entryPoints: ["src/extension.ts"], outfile: "dist/extension.cjs", platform: "node", format: "cjs", external: ["vscode"], target: "node22" },
  { entryPoints: ["webview/main.ts"], outfile: "dist/webview.js", platform: "browser", format: "iife", target: "es2022" },
  { entryPoints: ["webview/styles.css"], outfile: "dist/webview.css" },
  { entryPoints: ["tests/extensionSmoke.ts"], outfile: "dist/extensionSmoke.cjs", platform: "node", format: "cjs", external: ["vscode"], target: "node22" },
]

for (const configuration of configurations) {
  const options: BuildOptions = { ...configuration, absWorkingDir: root, bundle: true, sourcemap: true, logLevel: "info", logOverride: { "css-syntax-error": "error" } }
  if (process.argv.includes("--watch")) {
    await (await context(options)).watch()
  } else {
    await build(options)
  }
}
