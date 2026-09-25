import { readFile, readdir, realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { build, type Plugin } from "esbuild"
import { productionEntries } from "../scripts/support/productionEntries.ts"

const shared = ["packages/app-server", "packages/history", "packages/protocol"]
/** 共享 Node 包禁止编辑器与 React。@codem/ui 可以使用浏览器 UI 库。 */
const editorRuntime = /^(?:vscode|electron)(?:\/|$)/
const reactRuntime = /^(?:react|react-dom)(?:\/|$)/
const platformImport = /^(?:vscode|electron|react|react-dom)(?:\/|$)/
const allowedUiDependencies = new Set([
  "@codem/protocol",
  "react",
  "react-dom",
  "radix-ui",
  "lucide-react",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
  "cmdk",
  "marked",
  "dompurify",
])

function within(path: string, root: string): boolean {
  const local = relative(root, path)
  return !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`)
}

/** 只把仓库根目录归档 `history/` 当禁区，不能误伤活跃包 `packages/history/`。 */
function isArchivedHistory(root: string, path: string): boolean {
  const archive = join(root, "history")
  return path === archive || path.startsWith(`${archive}${sep}`)
}

function isArchivedImport(specifier: string): boolean {
  if (specifier === "@codem/history" || specifier.startsWith("@codem/history/")) return false
  if (specifier.includes("packages/history")) return false
  const normalized = specifier.replaceAll("\\", "/")
  return normalized === "history" || normalized.startsWith("history/") || /(?:^|\/)\.\.\/history(?:\/|$)/.test(normalized)
}

/** Inspect resolution without executing code, launching Core, or writing bundles. */
export async function checkWorkspaceArchitecture(root: string): Promise<void> {
  root = await realpath(root)
  const entries: string[] = []
  for (const directory of ["apps/vscode/src", "apps/vscode/webview", ...shared.map(path => `${path}/src`)]) {
    await collect(root, join(root, directory), entries)
  }
  await collectIfPresent(root, join(root, "packages/ui/src"), entries)
  if (await present(join(root, "packages/contracts/package.json"))) await checkContractsPackage(root)
  if (await present(join(root, "packages/ui/package.json"))) await checkUiPackage(join(root, "packages/ui"))
  for (const directory of shared) {
    const manifestPath = join(root, directory, "package.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>
    for (const kind of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      const dependencies = manifest[kind] as Record<string, string> | undefined
      for (const [name, version] of Object.entries(dependencies ?? {})) {
        if (directory === "packages/protocol" || platformImport.test(name) || isArchivedImport(version)) {
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
        const isUi = within(args.importer, join(root, "packages/ui"))
        const application = join(root, "apps/vscode")
        const contracts = join(application, "src/shared")
        const webview = join(application, "webview")
        const conversationOwners = ["src/resources/conversationResources.ts", "src/chat/backgroundTasks.ts", "src/sessionHistory/conversationHistory.ts"]
        const isConversationOwner = conversationOwners.some(file => args.importer === join(application, file))
        // Settings receive the Host panel as an injected capability; they never reach the coordinator, UI or an entry point.
        const isSettingsOwner = args.importer === join(application, "src/chat/chatSettings.ts")
        const settingsForbidden = (path: string) => ["src/chat/chatController.ts", "src/chat/chatSurfaces.ts", "src/extension.ts"].some(file => path === join(application, file))
          || ["src/nativeChat", "src/panels", "webview"].some(directory => within(path, join(application, directory))) || within(path, join(root, "packages/ui"))
        // Entries are roots: they assemble features, and no production module reaches back into one.
        const entries = Object.values(productionEntries).map(entry => join(application, entry.path))
        const isContract = within(args.importer, contracts)
        const isView = within(args.importer, webview)
        const problem = (message: string) => ({ errors: [{ text: `${args.importer || args.path}: ${message}: ${args.path}` }] })
        if (isArchivedImport(args.path)) return problem("archived imports are forbidden")
        if (owner && (editorRuntime.test(args.path) || reactRuntime.test(args.path))) return problem("shared source cannot import an editor/UI runtime")
        if (isSettingsOwner && (platformImport.test(args.path) || /^@codem\/ui(?:\/|$)/.test(args.path))) return problem("the settings owner cannot import the coordinator, UI or entry points")
        // Cycle 3：正式 UI 可用 React/shadcn，仍禁止 Node、VS Code、Electron、app-server、history。
        if (isUi && (args.path.startsWith("node:") || editorRuntime.test(args.path) || args.path.startsWith("@codem/app-server") || args.path.startsWith("@codem/history"))) {
          return problem("UI cannot import Node or editor hosts")
        }
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
        if (isArchivedHistory(root, path)) return problem("resolution reaches archived source")
        if (owner && !within(path, join(root, owner))) {
          return problem("shared source must use package exports instead of crossing source directories")
        }
        if (isConversationOwner && ["src/chat/chatController.ts", "src/chat/chatSurfaces.ts", "src/extension.ts"].some(file => path === join(application, file))) return problem("conversation state owners cannot import the coordinator")
        if (isSettingsOwner && settingsForbidden(path)) return problem("the settings owner cannot import the coordinator, UI or entry points")
        if (args.importer && entries.includes(path)) return problem("production modules cannot import an application entry")
        if (isView && within(path, join(application, "src")) && !within(path, contracts)) return problem("Webview cannot import Host implementation")
        if (isContract && !within(path, contracts)) return problem("application contracts cannot depend on features")
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

async function collect(root: string, directory: string, entries: string[], visited = new Set<string>()): Promise<void> {
  const canonical = await realpath(directory)
  if (isArchivedHistory(root, canonical)) throw new Error(`${directory}: source resolves into history`)
  if (visited.has(canonical)) return
  visited.add(canonical)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (isArchivedHistory(root, await realpath(path))) throw new Error(`${path}: source resolves into history`)
    if (entry.isDirectory() || (entry.isSymbolicLink() && (await stat(path)).isDirectory())) await collect(root, path, entries, visited)
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) entries.push(path)
  }
}

async function present(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function collectIfPresent(root: string, directory: string, entries: string[]): Promise<void> {
  if (await present(directory)) await collect(root, directory, entries)
}

async function checkContractsPackage(root: string): Promise<void> {
  const manifestPath = join(root, "packages/contracts/package.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>
  for (const kind of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    if (manifest[kind] && Object.keys(manifest[kind] as object).length) {
      throw new Error(`${manifestPath}: contracts cannot have production ${kind}`)
    }
  }
}

async function checkUiPackage(directory: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>
  }
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (!allowedUiDependencies.has(name)) {
      throw new Error(`${directory}: UI cannot depend on ${name}=${version}`)
    }
  }
}
