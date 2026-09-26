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
    // The account, auto-connect, chat-log, action-routing and command owners run for real; the rest of the entry's collaborators are stubbed.
    const real = ["accountController.ts", "autoConnect.ts", "chatLog.ts", "viewActionRouter.ts", "chatCommands.ts"]
    b.onResolve({ filter: /^\.\// }, args => args.importer.endsWith("/src/extension.ts") && !real.some(name => args.path.endsWith(`/${name}`)) ? { path: "dependencies", namespace: "fixture" } : undefined)
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "vscode" ? `
      const disposable = {dispose(){}};
      export const control = {available:false, trusted:true, folders:[{}], setting:undefined, calls:0, authReads:0, logins:0, logouts:0, resets:0, draftsCleared:0, selectionsCleared:0, signedIn:true, accountPages:0, focusCalls:0, loginPending:Promise.resolve(), contexts:{}, commands:{}, pending:Promise.resolve()};
      export const workspace = {
        get isTrusted(){return control.trusted}, get workspaceFolders(){return control.folders},
        getConfiguration(){return {get:(key,fallback)=>control.setting ?? fallback}},
        onDidGrantWorkspaceTrust(fn){control.grantTrust=fn;return disposable},
        onDidChangeConfiguration(fn){control.configuration=fn;return disposable},
      };
      export const window = {createOutputChannel(){return {appendLine(){},dispose(){}}}};
      export class EventEmitter {listeners=[];event=fn=>{this.listeners.push(fn);return disposable};fire(value){for(const fn of this.listeners)fn(value)}dispose(){}}
      export const Disposable = {from(...items){return {dispose(){for(const item of items)item.dispose()}}}};
      export const commands = {async executeCommand(name,key,value){if(name!=="setContext")throw new Error(name);control.contexts[key]=value},registerCommand(name,fn){control.commands[name]=fn;return disposable}};
    ` : `
      import {control} from 'vscode';
      export function accountOperations(){return {logout:async()=>{control.logouts++;control.signedIn=false;return {loggedIn:false,routerCredential:false}},read:async()=>{control.authReads++;return {avatar:{kind:"none"},loggedIn:control.signedIn,routerCredential:control.signedIn,displayName:null,userId:null,tenantId:null,authMethod:null}},login:async()=>{control.logins++;await control.loginPending;control.signedIn=true;return {avatar:{kind:"none"},loggedIn:true,routerCredential:true,displayName:null,userId:null,tenantId:null,authMethod:null}}}}
      export class ChatController { async connect(){control.calls++;await control.pending} async dispose(){} async resetAccount(){control.resets++} publish(){} }
      export class ChatSurfaces {serve(handlers){control.dispatch=(action,reply)=>handlers.dispatch(action,reply)} get available(){return control.available} post(){} resetDraft(){control.draftsCleared++} async focus(){control.focusCalls++} async openAccount(){control.accountPages++} dispose(){} }
      export class ConnectionPreferences {}
      export class SessionOpener {}
      export class EditorSelection {state={snapshot(){return null},setContext(){},clear(){control.selectionsCleared++}};dispose(){}}
      export class EditorReview {contextChanged(){} dispose(){}}
      export class NextEdit {contextChanged(){} dispose(){}}
      export class ActiveConversation {}
      export class NativeFeatures {dispose(){}}
      export class PanelBroker {cancel(){} followChat(){}}
      export class UserVisibleError extends Error {}
      export function assertTrusted(){}
      export async function connectRuntime(){throw new Error('No real runtime in this fixture')}
      export function showInteraction(){}
      export function registerGitActions(){return {dispose(){}}}
      export const registerInlineCompletion=registerGitActions, registerTerminalActions=registerGitActions, registerEditorActions=registerGitActions, registerKeepAwake=registerGitActions;
    ` }))
  } }] })
  const { activate, deactivate, control } = await import(pathToFileURL(outfile).href)
  t.after(deactivate)
  const context = { subscriptions: [], workspaceState: {}, secrets: {}, extensionPath: "/extension", extension: { packageJSON: { version: "0.0.0" } } }
  activate(context)
  assert.equal(control.contexts["codem.accountStatus"], "checking")
  const ready = () => control.dispatch({ type: "ready" }, () => {})
  await ready()
  assert.equal(control.calls, 0, "Activation without a visible chat must not connect")
  assert.equal(control.contexts["codem.accountStatus"], "signedIn")
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
  assert.equal(control.contexts["codem.accountStatus"], "signedOut")
  await control.commands["codem.signIn"]()
  assert.equal(control.logins, 1)
  assert.equal(control.calls, 3, "Login is independent of Core, folders and trust")
  const focusCalls = control.focusCalls
  const reads = control.authReads
  await control.commands["codem.signIn"]()
  assert.equal(control.accountPages, 1, "A stale Login command opens the signed-in account instead of silently returning")
  await control.commands["codem.account"]()
  assert.equal(control.accountPages, 2)
  assert.equal(control.focusCalls, focusCalls, "Account navigation must not also focus the composer and steal keyboard focus")
  assert.equal(control.authReads, reads, "Commands reuse known identity; the account page owns its refresh")
  assert.equal(control.calls, 3, "Opening account must not connect Core")
  assert.equal(control.logins, 1, "An already signed-in account must not launch login again")
  await Promise.all([control.dispatch({ type: "signOut" }, () => {}), control.dispatch({ type: "signOut" }, () => {})])
  assert.equal(control.contexts["codem.accountStatus"], "signedOut")
  assert.equal(control.logouts, 1)
  assert.equal(control.resets, 1); assert.equal(control.draftsCleared, 1); assert.equal(control.selectionsCleared, 1)
  await ready()
  assert.equal(control.calls, 3, "Reload after logout must not reconnect")
  let receipt: unknown
  await control.dispatch({ type: "send", text: "stale request", requestId: "old" }, (value: unknown) => { receipt = value })
  assert.deepEqual(receipt, { type: "sendResult", requestId: "old", accepted: false })
  let finishLogin!: () => void
  control.loginPending = new Promise<void>(resolve => { finishLogin = resolve })
  const login = control.commands["codem.signIn"]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(control.contexts["codem.accountStatus"], "signingIn")
  await control.commands["codem.signIn"]()
  assert.equal(control.logins, 2, "Repeated native login shows the pending operation without starting another")
  finishLogin(); await login
  assert.equal(control.contexts["codem.accountStatus"], "signedIn")
})

it("native account menus follow the authoritative account state", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  for (const menu of ["view/title", "commandPalette"]) {
    const entries = manifest.contributes.menus[menu].filter((item: { command: string }) => ["codem.signIn", "codem.account"].includes(item.command))
    assert.equal(entries.length, 2)
    for (const status of ["checking", "signedOut", "error", "signingIn", "signedIn", "signingOut", "signOutFailed"]) {
      const visible = entries.filter((item: { when: string }) => {
        const expression = item.when.replace(/view == codem.chat/g, "true").replace(/codem.accountStatus (!=|==) (\w+)/g, (_: string, operator: string, value: string) => String(operator === "==" ? status === value : status !== value))
        assert.match(expression, /^[truefals&| ()]+$/)
        return new Function(`return (${expression})`)()
      })
      assert.deepEqual(visible.map((item: { command: string }) => item.command), [["signedIn", "signingOut", "signOutFailed"].includes(status) ? "codem.account" : "codem.signIn"], `${menu}: ${status}`)
    }
  }
})
