import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build, type BuildOptions, type Plugin } from "esbuild"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const outdir = join(root, "dist")
await mkdir(outdir, { recursive: true })

const shadcnStyles: Plugin = {
  name: "shadcnStyles",
  setup(builder) {
    builder.onLoad({ filter: /styles\.css$/ }, async (args) => {
      const result = await postcss([tailwindcss()]).process(await readFile(args.path, "utf8"), { from: args.path })
      return { contents: result.css, loader: "css", resolveDir: dirname(args.path) }
    })
  },
}

const common: BuildOptions = {
  absWorkingDir: root,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  plugins: [shadcnStyles],
}

await build({ ...common, entryPoints: [join(root, "src/browser.ts")], outfile: join(outdir, "browser.js") })
await build({ ...common, entryPoints: [join(root, "src/preview.ts")], outfile: join(outdir, "preview.js") })
await build({ ...common, entryPoints: [join(root, "src/styles.css")], outfile: join(outdir, "styles.css") })
await copyFile(join(root, "src/index.html"), join(outdir, "index.html"))
await copyFile(join(root, "src/preview.html"), join(outdir, "preview.html"))
await writeFile(join(outdir, "README.txt"), "CodeM dual-host UI. preview.html proves the shared mount contract.\n")
