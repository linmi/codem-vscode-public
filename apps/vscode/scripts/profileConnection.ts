/** Explicit real-Core preflight profiling; no model turns and no VS Code windows. */
import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { resolve } from "node:path"
const root = fileURLToPath(new URL("..", import.meta.url))
const argument = process.argv.indexOf("--workspace")
if (argument < 0 || !process.argv[argument + 1]) throw new Error("Pass --workspace <existing trusted test workspace>")
const workspace = resolve(process.argv[argument + 1]!)
const outfile = resolve(root, "dist/connectionProfile.cjs")
await build({
  absWorkingDir: root, entryPoints: ["tests/connectionProfile.ts"], outfile, bundle: true, platform: "node", format: "cjs", target: "node22", logLevel: "silent",
  define: { PROFILE_WORKSPACE: JSON.stringify(workspace), PROFILE_EXTENSION: JSON.stringify(root) },
  plugins: [{ name: "profileAdapters", setup(builder) {
    builder.onResolve({ filter: /^(vscode|observedAppServer)$/ }, args => ({ path: args.path, namespace: "profile" }))
    builder.onLoad({ filter: /.*/, namespace: "profile" }, args => ({ resolveDir: root, contents: args.path === "vscode" ? `
      export const Uri = { file: fsPath => ({ scheme: 'file', fsPath }) };
      export const workspace = { isTrusted: true, workspaceFolders: [{ name: 'profile', uri: Uri.file(PROFILE_WORKSPACE) }] };
      const unexpected = () => { throw new Error('Profile requires existing login and current space; no UI prompts supported') };
      export const window = { showWorkspaceFolderPick: unexpected, showQuickPick: unexpected, withProgress: unexpected };
      export const env = { openExternal: unexpected }; export const ProgressLocation = { Notification: 1 };
    ` : `
      import * as api from '@codem/app-server';
      export * from '@codem/app-server';
      export const counts = { auth: 0, list: 0, prepare: 0 };
      export const readAppServerAuthStatus = options => { counts.auth++; return api.readAppServerAuthStatus(options) };
      export const listAppServerSpaces = options => { counts.list++; return api.listAppServerSpaces(options) };
      export const prepareAppServerSpace = (options, key) => { counts.prepare++; return api.prepareAppServerSpace(options, key) };
    ` }))
    builder.onLoad({ filter: /[/\\]runtimeSession\.ts$/ }, async args => ({ contents: (await readFile(args.path, "utf8")).replace('from "@codem/app-server"', 'from "observedAppServer"'), loader: "ts" }))
  } }],
})
const child = spawn(process.execPath, [outfile], { stdio: "inherit" })
const code = await new Promise<number | null>((done, reject) => { child.once("error", reject); child.once("exit", done) })
if (code !== 0) throw new Error("Connection profile failed")
