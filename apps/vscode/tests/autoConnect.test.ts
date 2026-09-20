import assert from "node:assert/strict"
import { it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

it("initializes on opening chat by default, once per activation, with explicit retry and opt-out", async t => {
  const root = fileURLToPath(new URL("../../..", import.meta.url))
  const manifest = JSON.parse(await readFile(join(root, "apps/vscode/package.json"), "utf8"))
  assert.equal(manifest.contributes.configuration.properties["codem.autoConnect"].default, true)
  const directory = await mkdtemp(join(tmpdir(), "codem-auto-connect-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: {
    contents: `export { activate, deactivate } from './apps/vscode/src/extension.ts'; export { control } from 'vscode';`, resolveDir: root,
  }, plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "fixture" }))
    b.onResolve({ filter: /^\.\// }, args => args.importer.endsWith("/src/extension.ts") && !args.path.endsWith("accountController.ts") ? { path: "dependencies", namespace: "fixture" } : undefined)
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "vscode" ? `
      const disposable = {dispose(){}};
      export const control = {available:false, trusted:true, folders:[{}], setting:undefined, calls:0, authReads:0, logins:0, signedIn:true, commands:{}, pending:Promise.resolve()};
      export const workspace = {
        get isTrusted(){return control.trusted}, get workspaceFolders(){return control.folders},
        getConfiguration(){return {get:(key,fallback)=>control.setting ?? fallback}},
        onDidGrantWorkspaceTrust(fn){control.grantTrust=fn;return disposable},
        onDidChangeConfiguration(fn){control.configuration=fn;return disposable},
      };
      export const window = {createOutputChannel(){return {appendLine(){},dispose(){}}}};
      export const commands = {registerCommand(name,fn){control.commands[name]=fn;return disposable}};
    ` : `
      import {control} from 'vscode';
      export function accountOperations(){return {read:async()=>{control.authReads++;return {loggedIn:control.signedIn,routerCredential:control.signedIn,displayName:null,userId:null,tenantId:null,authMethod:null}},login:async()=>{control.logins++;control.signedIn=true;return {loggedIn:true,routerCredential:true,displayName:null,userId:null,tenantId:null,authMethod:null}}}}
      export class ChatController { async connect(){control.calls++;await control.pending} async dispose(){} publish(){} }
      export class ChatSurfaces {constructor(context,panels,dispatch){control.dispatch=dispatch} get available(){return control.available} post(){} async focus(){} dispose(){} }
      export class ConnectionPreferences {}
      export class EditorSelection {state={snapshot(){return null},setContext(){}};dispose(){}}
      export class ActiveConversation {}
      export class NativeFeatures {dispose(){}}
      export class PanelBroker {cancel(){}}
      export class UserVisibleError extends Error {}
      export function assertTrusted(){}
      export async function connectRuntime(){throw new Error('No real runtime in this fixture')}
      export function showInteraction(){}
      export function registerGitActions(){return {dispose(){}}}
      export const registerInlineCompletion=registerGitActions, registerTerminalActions=registerGitActions, registerEditorActions=registerGitActions;
    ` }))
  } }] })
  const { activate, deactivate, control } = await import(pathToFileURL(outfile).href)
  t.after(deactivate)
  const context = { subscriptions: [], workspaceState: {}, secrets: {} }
  activate(context)
  const ready = () => control.dispatch({ type: "ready" }, () => {})
  await ready()
  assert.equal(control.calls, 0, "Activation without a visible chat must not connect")
  control.available = true
  control.trusted = false
  await ready()
  assert.equal(control.calls, 0, "Untrusted workspaces must not connect")
  control.trusted = true
  control.folders = []
  await ready()
  assert.equal(control.calls, 0, "No workspace must not connect")
  control.folders = [{}]
  let finish!: () => void
  control.pending = new Promise<void>(resolve => { finish = resolve })
  const opening = ready()
  await Promise.resolve()
  assert.equal(control.calls, 1)
  await ready()
  control.grantTrust()
  control.configuration({ affectsConfiguration: (key: string) => key === "codem.autoConnect" })
  assert.equal(control.calls, 1, "Repeated ready, trust and setting events must not duplicate initialization")
  finish()
  await opening
  await ready()
  assert.equal(control.calls, 1, "Webview reload must reuse the completed attempt")
  await control.dispatch({ type: "connect" }, () => {})
  assert.equal(control.calls, 2, "Explicit retry must remain available")
  await deactivate()
  control.setting = false
  activate(context)
  await ready()
  assert.equal(control.calls, 2, "Explicit opt-out must be honored")
  control.setting = true
  control.configuration({ affectsConfiguration: (key: string) => key === "codem.autoConnect" })
  assert.equal(control.calls, 3, "Enabling initialization while chat is open must connect")
  assert.equal(control.authReads, 2, "Reloads reuse account display, each activation reads once")
  await deactivate()
  control.signedIn = false; control.folders = []; control.trusted = false
  activate(context); await ready()
  assert.equal(control.calls, 3, "Signed-out account never connects Core")
  await control.dispatch({ type: "signIn" }, () => {})
  assert.equal(control.logins, 1)
  assert.equal(control.calls, 3, "Login is independent of Core, folders and trust")
  await control.commands["codem.signIn"]()
  assert.equal(control.logins, 1, "An already signed-in account must not launch login again")
})
