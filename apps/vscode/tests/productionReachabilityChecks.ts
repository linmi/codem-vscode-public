import { execFileSync } from "node:child_process"
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { build } from "esbuild"
import type { ProductionEntry } from "../scripts/support/productionEntries.ts"

const tsc = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin/tsc")

/** TypeScript files under src/ and webview/ that no production entry reaches, at runtime or as a type. */
export async function unreachableSources(appRoot: string, entries: readonly ProductionEntry[]): Promise<string[]> {
  appRoot = await realpath(appRoot)
  const reached = new Set<string>()
  // Runtime graph: the same resolution esbuild uses for the shipped bundles.
  for (const entry of entries) {
    const result = await build({
      absWorkingDir: appRoot, entryPoints: [entry.path], outdir: "reachability", bundle: true, write: false, metafile: true,
      platform: entry.platform, packages: "external", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "silent",
    })
    for (const input of Object.keys(result.metafile.inputs)) reached.add(resolve(appRoot, input))
  }
  // Type graph: esbuild erases `import type`, so let tsc list what the entries pull in.
  const directory = await mkdtemp(join(tmpdir(), "codem-reachability-"))
  try {
    const config = join(directory, "tsconfig.json")
    await writeFile(config, JSON.stringify({
      extends: join(appRoot, "tsconfig.json"),
      // Ambient type libraries are not sources and would resolve relative to this temporary directory.
      compilerOptions: { noEmit: true, jsx: "react-jsx", types: [] },
      files: entries.map(entry => join(appRoot, entry.path)), include: [],
    }))
    const listed = execFileSync(process.execPath, [tsc, "-p", config, "--listFilesOnly"], { encoding: "utf8" })
    for (const line of listed.split(/\r?\n/)) if (line.trim()) reached.add(resolve(line.trim()))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  const sources = [...await collect(join(appRoot, "src")), ...await collect(join(appRoot, "webview"))]
  return sources.filter(file => !reached.has(file)).map(file => relative(appRoot, file).replaceAll("\\", "/")).sort()
}

export async function checkProductionReachability(appRoot: string, entries: readonly ProductionEntry[]): Promise<void> {
  const unreachable = await unreachableSources(appRoot, entries)
  if (unreachable.length) {
    throw new Error(`Not reachable from any production entry (${entries.map(entry => entry.path).join(", ")}); delete it or import it from production code:\n${unreachable.join("\n")}`)
  }
}

async function collect(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collect(path))
    else if (/\.[cm]?tsx?$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) files.push(path)
  }
  return files
}
