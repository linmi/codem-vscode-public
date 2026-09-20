import assert from "node:assert/strict"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { it, type TestContext } from "node:test"
import type { connectRuntime as ConnectRuntime } from "../src/connection/runtimeSession.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
interface Control {
  calls: string[]
  selection: boolean
  cancelPick: boolean
  failModels: boolean
  afterInitial: () => void
}

async function setup(t: TestContext): Promise<{ connectRuntime: typeof ConnectRuntime; control: Control }> {
  const directory = await mkdtemp(join(tmpdir(), "codem-runtime-startup-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({
    absWorkingDir: root, outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent",
    stdin: { contents: 'export { connectRuntime } from "./src/connection/runtimeSession.ts"; export { control } from "startupFixture"', resolveDir: root },
    plugins: [{ name: "startupFixture", setup(builder) {
      builder.onResolve({ filter: /^(vscode|startupFixture|@codem\/app-server)$/ }, args => {
        if (args.path === "@codem/app-server" && !args.importer.endsWith("runtimeSession.ts")) return
        return { path: args.path, namespace: "startupFixture" }
      })
      builder.onLoad({ filter: /.*/, namespace: "startupFixture" }, args => ({ resolveDir: root, contents: args.path === "startupFixture" ? `
        export const control = {calls:[], selection:false, cancelPick:false, failModels:false, afterInitial:()=>{}};
      ` : args.path === "vscode" ? `
        import { control } from 'startupFixture';
        export const workspace = {isTrusted:true, workspaceFolders:[{name:'test',uri:{scheme:'file',fsPath:${JSON.stringify(root)}}}]};
        export const window = {showQuickPick:async items=>{control.calls.push('pick'); return control.cancelPick ? undefined : items[0]}};
      ` : `
        import { control } from 'startupFixture';
        export { assertAppServerAuthenticated } from '../../packages/app-server/src/authentication.ts';
        const space = {projectKey:'proj_test', displayName:'Test', managedDirectory:null};
        const catalog = {current:'proj_test',spaces:[{projectKey:'proj_test',displayName:'Test'}]};
        export const resolveBundledAppServerRuntime=()=>({});
        export const readAppServerAuthStatus=async()=>{control.calls.push('auth'); return {loggedIn:true,routerCredential:true,userId:'user',tenantId:'tenant',serverUrl:'https://fixture.invalid'}};
        export const startAppServerLogin=()=>{throw Error('unexpected login')};
        export const listAppServerSpaces=async()=>{control.calls.push('list'); return catalog};
        export const prepareInitialAppServerSpace=async()=>{control.calls.push('initial'); control.afterInitial(); return control.selection ? {kind:'selection-required',catalog:{...catalog,current:null}} : {kind:'prepared',catalog,space}};
        export const prepareAppServerSpace=async()=>{control.calls.push('prepare'); return space};
        export class AppServerHost {
          constructor(options){this.options=options}
          async prepareConnection(){await this.options.assertAuthenticated(); await this.options.prepareSpace(); control.calls.push('core')}
          async listModels(){control.calls.push('models'); if(control.failModels) throw Error('models unavailable'); return {activeModel:'model',models:[{id:'model'}]}}
          async close(){control.calls.push('close')}
        }
      ` }))
    } }],
  })
  return import(pathToFileURL(outfile).href)
}

it("startup gate: consumes prepared launch material without a second broker and revalidates on repeat connection", async t => {
  const f = await setup(t)
  const abort = new AbortController()
  const first = await f.connectRuntime(root, "test", false, abort.signal)
  assert.deepEqual(f.control.calls, ["auth", "initial", "core", "models"])
  f.control.calls.length = 0
  const second = await f.connectRuntime(root, "test", false, abort.signal)
  assert.deepEqual(f.control.calls, ["auth", "initial", "core", "models"])
  await Promise.all([first.host.close(), second.host.close()])
})

it("startup gate: cached directory keeps selection fast but cannot reuse previous launch authorization", async t => {
  const f = await setup(t)
  const abort = new AbortController()
  const first = await f.connectRuntime(root, "test", false, abort.signal)
  f.control.calls.length = 0
  const next = await f.connectRuntime(root, "test", false, abort.signal, {cwd: first.cwd,workspace:first.workspace,key:first.space.key}, first.spaceDirectory)
  assert.deepEqual(f.control.calls, ["auth", "prepare", "core", "models"])
  await Promise.all([first.host.close(), next.host.close()])
})

it("startup gate: user selection renews authentication before fresh preparation; cancellation never starts Core", async t => {
  const f = await setup(t)
  f.control.selection = true
  const session = await f.connectRuntime(root, "test", false, new AbortController().signal)
  assert.deepEqual(f.control.calls, ["auth", "initial", "pick", "auth", "prepare", "core", "models"])
  await session.host.close()
  f.control.calls.length = 0
  f.control.cancelPick = true
  await assert.rejects(f.connectRuntime(root, "test", false, new AbortController().signal), /未选择/)
  assert.deepEqual(f.control.calls, ["auth", "initial", "pick"])
})

it("startup gate: cancellation after preparation cannot start Core", async t => {
  const f = await setup(t)
  const abort = new AbortController()
  f.control.afterInitial = () => abort.abort()
  await assert.rejects(f.connectRuntime(root, "test", false, abort.signal), {name:"AbortError"})
  assert.deepEqual(f.control.calls, ["auth", "initial"])
})

it("startup gate: model failure closes Core and retry performs a fresh startup transaction", async t => {
  const f = await setup(t)
  f.control.failModels = true
  await assert.rejects(f.connectRuntime(root, "test", false, new AbortController().signal), /models unavailable/)
  assert.deepEqual(f.control.calls, ["auth", "initial", "core", "models", "close"])
  f.control.calls.length = 0
  f.control.failModels = false
  const session = await f.connectRuntime(root, "test", false, new AbortController().signal)
  assert.deepEqual(f.control.calls, ["auth", "initial", "core", "models"])
  await session.host.close()
})
