import { readFile, readdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { build, type Plugin } from "esbuild"

const shared = ["packages/app-server", "packages/session-history", "packages/protocol"]
const platformImport = /^(?:vscode|electron|react|react-dom)(?:\/|$)/
const historySegment = /(?:^|[/\\])history(?:[/\\]|$)/

function within(path: string, root: string): boolean {
  const local = relative(root, path)
  return !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`)
}

/** Inspect resolution without executing code, launching Core, or writing bundles. */
export async function checkWorkspaceArchitecture(root: string): Promise<void> {
  root = await realpath(root)
  const entries: string[] = []
  for (const directory of ["apps/vscode/src", "apps/vscode/webview", ...shared.map(path => `${path}/src`)]) {
    await collect(join(root, directory), entries)
  }
  for (const directory of shared) {
    const manifestPath = join(root, directory, "package.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>
    for (const kind of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      const dependencies = manifest[kind] as Record<string, string> | undefined
      for (const [name, version] of Object.entries(dependencies ?? {})) {
        if (directory === "packages/protocol" || platformImport.test(name) || historySegment.test(version)) {
          throw new Error(`${manifestPath}: forbidden ${kind} ${name}=${version}`)
        }
      }
    }
    const configPath = join(root, directory, "tsconfig.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as { compilerOptions: { lib?: string[]; types?: string[] } }
    const { lib, types } = config.compilerOptions
    if (!lib?.length || lib.some(value => !/^ES\d{4}$/i.test(value))) {
      throw new Error(`${configPath}: shared source must explicitly use ES libraries without DOM`)
    }
    const allowedTypes = directory === "packages/protocol" ? [] : ["node"]
    if (!types || types.some(value => !allowedTypes.includes(value))) {
      throw new Error(`${configPath}: unexpected ambient platform types`)
    }
  }

  const boundary: Plugin = {
    name: "workspaceArchitecture",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, async args => {
        if (args.pluginData?.architectureResolved) return
        const owner = shared.find(directory => within(args.importer, join(root, directory)))
        const application = join(root, "apps/vscode")
        const contracts = join(application, "src/shared")
        const webview = join(application, "webview")
        const components = join(webview, "components")
        const conversationOwners = ["src/resources/conversationResources.ts", "src/chat/backgroundTasks.ts", "src/sessionHistory/conversationHistory.ts"]
        const isConversationOwner = conversationOwners.some(file => args.importer === join(application, file))
        const isContract = within(args.importer, contracts)
        const isView = within(args.importer, webview)
        const isComponent = within(args.importer, components)
        const problem = (message: string) => ({ errors: [{ text: `${args.importer || args.path}: ${message}: ${args.path}` }] })
        if (historySegment.test(args.path)) return problem("archived imports are forbidden")
        if (owner && platformImport.test(args.path)) return problem("shared source cannot import an editor/UI runtime")
        const resolved = await builder.resolve(args.path, {
          kind: args.kind, importer: args.importer, resolveDir: args.resolveDir,
          pluginData: { architectureResolved: true },
        })
        if (resolved.errors.length) return { errors: resolved.errors }
        if (resolved.external) {
          if (owner === "packages/protocol") return problem("protocol cannot have external runtime imports")
          if (isContract && args.path !== "@codem/protocol") return problem("application contracts cannot import external runtimes")
          return { path: resolved.path, external: true }
        }
        const path = await realpath(resolved.path)
        if (historySegment.test(path)) return problem("resolution reaches archived source")
        if (owner && !within(path, join(root, owner))) {
          return problem("shared source must use package exports instead of crossing source directories")
        }
        if (isConversationOwner && ["src/chat/chatController.ts", "src/chat/chatSurfaces.ts", "src/extension.ts"].some(file => path === join(application, file))) return problem("conversation state owners cannot import the coordinator")
        if (isView && within(path, join(application, "src")) && !within(path, contracts)) return problem("Webview cannot import Host implementation")
        if (isContract && !within(path, contracts)) return problem("application contracts cannot depend on features")
        if (isComponent && within(path, application) && !within(path, components)) return problem("base UI cannot depend on application features")
        return { path }
      })
    },
  }
  await build({
    absWorkingDir: root, entryPoints: entries, outdir: join(root, "dist/architectureCheck"),
    bundle: true, write: false, packages: "external", platform: "node", format: "esm",
    jsx: "automatic", logLevel: "silent", plugins: [boundary],
  })
}

async function collect(directory: string, entries: string[], visited = new Set<string>()): Promise<void> {
  const canonical = await realpath(directory)
  if (historySegment.test(canonical)) throw new Error(`${directory}: source resolves into history`)
  if (visited.has(canonical)) return
  visited.add(canonical)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (historySegment.test(await realpath(path))) throw new Error(`${path}: source resolves into history`)
    if (entry.isDirectory() || (entry.isSymbolicLink() && (await stat(path)).isDirectory())) await collect(path, entries, visited)
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) entries.push(path)
  }
}
