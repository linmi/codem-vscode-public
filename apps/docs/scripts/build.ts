import { copyFile, mkdir, readFile, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build, context, type BuildOptions } from "esbuild"
import postcss from "postcss"
import tailwindcss from "@tailwindcss/postcss"

const root = fileURLToPath(new URL("..", import.meta.url))
const outdir = join(root, "dist")
const manifest = JSON.parse(await readFile(join(root, "../../packages/app-server/package.json"), "utf8"))
const examples = Object.fromEntries(await Promise.all((await readdir(join(root, "examples")))
  .filter(name => name.endsWith(".ts"))
  .map(async name => [name.replace(/\.ts$/, ""), await readFile(join(root, "examples", name), "utf8")])))
await mkdir(outdir, { recursive: true })
for (const name of ["index.html", "favicon.svg"]) await copyFile(join(root, "src", name), join(outdir, name))
const options: BuildOptions = {
  absWorkingDir: root,
  entryPoints: ["src/main.tsx"], outdir, bundle: true, format: "esm", platform: "browser",
  target: "es2022", jsx: "automatic", minify: true, metafile: true,
  define: {
    __CODE_EXAMPLES__: JSON.stringify(examples),
    __RUNTIME_VERSIONS__: JSON.stringify({ sdk: manifest.version, core: manifest.dependencies["@lark-codem/codem-core"], cli: manifest.dependencies["@lark-codem/codem-cli"] }),
  },
  plugins: [{ name: "shadcnStyles", setup(builder) {
    builder.onLoad({ filter: /\.css$/ }, async args => {
      const result = await postcss([tailwindcss()]).process(await readFile(args.path, "utf8"), { from: args.path })
      return { contents: result.css, loader: "css", resolveDir: dirname(args.path), watchFiles: [args.path] }
    })
  } }],
}
if (process.argv.includes("--serve")) {
  const server = await context(options)
  await server.watch()
  const address = await server.serve({ host: "127.0.0.1", port: 4174, servedir: outdir })
  console.log(`CodeM docs: http://127.0.0.1:${address.port}`)
} else {
  const result = await build(options)
  const unsafe = Object.keys(result.metafile!.inputs).filter(path => /packages\/(app-server|history)\/src/.test(path))
  if (unsafe.length) throw new Error(`Node-only implementation entered browser bundle: ${unsafe.join(", ")}`)
  console.log("CodeM docs built; browser bundle contains no App Server or history implementation.")
}
