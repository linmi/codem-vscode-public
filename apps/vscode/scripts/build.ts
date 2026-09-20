import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { readFile, writeFile } from "node:fs/promises"
import { build, context, type BuildOptions, type Plugin } from "esbuild"
import { stageAppServerRuntime } from "@codem/app-server/build"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bundleNotices } from "./support/bundleNotices.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const require = createRequire(import.meta.url)
const packageRoot = resolve(dirname(require.resolve("@codem/app-server")), "..")
stageAppServerRuntime({ packageRoot, extensionRoot: root })

const shadcnStyles: Plugin = {
  name: "shadcnStyles",
  setup(builder) {
    builder.onLoad({ filter: /shadcnStyles\.css$/ }, async args => {
      const result = await postcss([tailwindcss()]).process(await readFile(args.path, "utf8"), { from: args.path })
      for (const message of result.messages) {
        if (message.type === "dependency" && typeof message.file === "string") productionInputs.add(message.file)
      }
      return {
        contents: result.css, loader: "css", resolveDir: dirname(args.path),
        watchFiles: [args.path, ...result.messages.flatMap(message => message.type === "dependency" && typeof message.file === "string" ? [message.file] : [])],
        watchDirs: result.messages.flatMap(message => message.type === "dir-dependency" && typeof message.dir === "string" ? [message.dir] : []),
      }
    })
  },
}

const configurations: BuildOptions[] = [
  { entryPoints: ["src/extension.ts"], outfile: "dist/extension.cjs", platform: "node", format: "cjs", external: ["vscode"], target: "node22" },
  { entryPoints: ["webview/main.ts"], outfile: "dist/webview.js", platform: "browser", format: "iife", target: "es2022", define: { "process.env.NODE_ENV": '"production"' } },
  { entryPoints: ["tests/previewNavigation.tsx"], outfile: "dist/previewNavigation.js", platform: "browser", format: "iife", target: "es2022", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, minify: true },
  { entryPoints: ["webview/styles.css"], outfile: "dist/webview.css" },
  { entryPoints: ["tests/extensionSmoke.ts"], outfile: "dist/extensionSmoke.cjs", platform: "node", format: "cjs", external: ["vscode"], target: "node22" },
]

const productionInputs = new Set<string>()
for (const configuration of configurations) {
  const options: BuildOptions = { ...configuration, absWorkingDir: root, jsx: "automatic", bundle: true, plugins: [shadcnStyles], sourcemap: true, logLevel: "info", logOverride: { "css-syntax-error": "error" } }
  if (process.argv.includes("--watch")) {
    await (await context(options)).watch()
  } else {
    const result = await build({ ...options, metafile: true })
    if (["dist/extension.cjs", "dist/webview.js", "dist/webview.css"].includes(configuration.outfile!)) {
      for (const input of Object.keys(result.metafile.inputs)) productionInputs.add(input)
    }
  }
}
if (!process.argv.includes("--watch")) {
  await writeFile(resolve(root, "dist/THIRD_PARTY_NOTICES.txt"), await bundleNotices(root, [...productionInputs]))
}
