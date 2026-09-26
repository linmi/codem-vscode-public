import assert from "node:assert/strict"
import { it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

it("one activation owns one runtime verifier, shared by the account read and every connection", async t => {
  const root = fileURLToPath(new URL("../../..", import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), "codem-runtime-integrity-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: {
    contents: `export { activate, deactivate } from './apps/vscode/src/extension.ts'; export { control } from 'vscode';`, resolveDir: root,
  }, plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^(vscode|@codem\/app-server)$/ }, args => ({ path: args.path, namespace: "fixture" }))
    // The owners the entry wires run for real, so the verifier is followed through them; the Core connection itself is stubbed.
    const real = ["accountController.ts", "autoConnect.ts", "chatLog.ts", "viewActionRouter.ts", "chatCommands.ts", "sessionOpener.ts"]
    const stubbed = (args: { importer: string; path: string }) => (args.importer.endsWith("/src/extension.ts") && !real.some(name => args.path.endsWith(`/${name}`))) || (args.importer.endsWith("/src/connection/sessionOpener.ts") && args.path === "./runtimeSession.ts")
    b.onResolve({ filter: /^\.\// }, args => stubbed(args) ? { path: "dependencies", namespace: "fixture" } : undefined)
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "vscode" ? `
      const disposable = {dispose(){}};
      export const control = {resolvers:[], verifications:0, accountRuntimes:[], connectionRuntimes:[], output:[]};
      export const workspace = {isTrusted:true, workspaceFolders:[{}], getConfiguration(){return {get:(key,fallback)=>fallback}}, onDidGrantWorkspaceTrust(){return disposable}, onDidChangeConfiguration(){return disposable}};
      export const window = {createOutputChannel(){return {appendLine(line){control.output.push(line)},dispose(){}}}, showErrorMessage(){}};
      export const commands = {async executeCommand(){}, registerCommand(){return disposable}};
      export class EventEmitter {listeners=[];event=fn=>{this.listeners.push(fn);return disposable};fire(value){for(const fn of this.listeners)fn(value)}dispose(){}}
      export const Disposable = {from(...items){return {dispose(){for(const item of items)item.dispose()}}}};
    ` : args.path === "@codem/app-server" ? `
      import {control} from 'vscode';
      export function createBundledAppServerRuntimeResolver(options){control.resolvers.push(options); return async()=>{control.verifications++; return {}}}
    ` : `
      import {control} from 'vscode';
      const identity = {avatar:{kind:"none"},loggedIn:true,routerCredential:true,displayName:null,userId:null,tenantId:null,authMethod:null};
      export function accountOperations(resolveRuntime){control.accountRuntimes.push(resolveRuntime); return {read:async()=>{await resolveRuntime(); return identity}, login:async()=>identity, logout:async()=>identity}}
      export async function connectRuntime(resolveRuntime){control.connectionRuntimes.push(resolveRuntime); await resolveRuntime(); return {host:{onEvent(){},async close(){}}}}
      export class ChatController {constructor(options){this.options=options} async connect(){await this.options.connect(new AbortController().signal)} async dispose(){} publish(){}}
      export class ChatSurfaces {serve(handlers){control.dispatch=(action,reply)=>handlers.dispatch(action,reply)} get available(){return true} post(){} dispose(){}}
      export class ConnectionPreferences {lastConnection(){return undefined}}
      export class EditorSelection {state={snapshot(){return null},setContext(){},clear(){}};dispose(){}}
      export class EditorReview {contextChanged(){} dispose(){}}
      export class NextEdit {contextChanged(){} dispose(){}}
      export class ActiveConversation {}
      export class NativeFeatures {async loadMcp(){return []} dispose(){}}
      export class PanelBroker {cancel(){} followChat(){}}
      export class UserVisibleError extends Error {}
      export function assertTrusted(){}
      export function showInteraction(){}
      export function registerGitActions(){return {dispose(){}}}
      export const registerInlineCompletion=registerGitActions, registerTerminalActions=registerGitActions, registerEditorActions=registerGitActions, registerKeepAwake=registerGitActions;
    ` }))
  } }] })
  const { activate, deactivate, control } = await import(pathToFileURL(outfile).href)
  t.after(deactivate)
  const context = { subscriptions: [], workspaceState: {}, secrets: {}, extensionPath: "/extension", extension: { packageJSON: { version: "0.2.0" } } }

  activate(context)
  await control.dispatch({ type: "ready" }, () => {})
  assert.equal(control.resolvers.length, 1)
  assert.equal(control.resolvers[0].extensionRoot, "/extension")
  assert.equal(control.verifications, 2, "The account read and the auto-connect each verify before running a binary")
  assert.equal(control.connectionRuntimes.length, 1)
  assert.equal(control.accountRuntimes[0], control.connectionRuntimes[0], "Account and connection must share the activation's verifier")
  control.resolvers[0].observe({ elapsedMs: 29, hashed: 2, reused: 0 })
  assert.ok(control.output.includes("Runtime integrity: 29ms; hashed 2, reused 0"))

  await deactivate()
  activate(context)
  assert.equal(control.resolvers.length, 2, "A new activation starts with its own verifier")
  assert.notEqual(control.accountRuntimes[1], control.accountRuntimes[0])
})
