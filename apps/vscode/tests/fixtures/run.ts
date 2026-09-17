import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { unlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const here = path.dirname(fileURLToPath(import.meta.url))

export async function fixture(name: string) {
  const root = path.resolve(here, "../..")
  const webview = path.join(root, "webview-ui")
  const require = createRequire(path.join(root, "package.json"))
  const solid = path.dirname(require.resolve("solid-js/package.json"))
  const aliases: Record<string, string> = {
    "solid-js": path.join(solid, "dist/solid.js"),
    "solid-js/web": path.join(solid, "web/dist/web.js"),
    "solid-js/store": path.join(solid, "store/dist/store.js"),
  }
  const result = await build({
    entryPoints: [path.join(here, `${name}.tsx`)],
    bundle: true,
    conditions: ["browser"],
    external: ["happy-dom"],
    format: "esm",
    loader: { ".css": "empty", ".svg": "dataurl" },
    logLevel: "silent",
    platform: "node",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "browser-fixture",
        setup(ctx) {
          ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
          ctx.onResolve({ filter: /pierre\/worker$/ }, (args) =>
            args.path.includes("@pierre") ? undefined : { path: path.join(webview, "pierre-worker.ts") },
          )
          ctx.onResolve({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, () => ({
            path: "worker",
            namespace: "fixture",
          }))
          ctx.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export default undefined",
            loader: "js",
          }))
        },
      },
      solidPlugin(),
    ],
  })
  const file = path.join(root, `.${name}-${crypto.randomUUID()}.mjs`)
  writeFileSync(file, result.outputFiles[0]!.contents)
  try {
    const child = spawnSync(process.execPath, [file], { cwd: webview, encoding: "utf8" })
    assert.equal(child.status, 0, `${child.stdout ?? ""}${child.stderr ?? ""}`)
  } finally {
    unlinkSync(file)
  }
}
