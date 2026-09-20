import assert from "node:assert/strict"
import { it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

it("moves one chat surface, preserves draft and pending sends, reuses the editor and rejects old surface messages", async t => {
  const directory = await mkdtemp(join(tmpdir(), "codem-surfaces-")); t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: { contents: `export { ChatSurfaces } from './apps/vscode/src/chatSurfaces.ts'; export { PanelBroker } from './apps/vscode/src/panelBroker.ts'; export { control } from 'vscode';`, resolveDir: process.cwd().endsWith("apps/vscode") ? join(process.cwd(), "../..") : process.cwd() }, plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "fixture" }))
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      const disposable = {dispose(){}};
      function surface(){let listener;let closed;return {messages:[], webview:{html:'',cspSource:'fixture',postMessage(m){this.owner.messages.push(m);return Promise.resolve(true)},asWebviewUri(){return {toString:()=>''}},onDidReceiveMessage(fn){listener=fn; return {dispose(){listener=undefined}}}},onDidDispose(fn){closed=fn;return disposable},reveal(){},dispose(){closed?.()},receive(m){listener?.(m)}}}
      function make(){const s=surface();s.webview.owner=s;return s}
      export const control={sidebar:make(),editors:[],provider:null};
      export const Uri={joinPath(){return {}}};
      export const ViewColumn={Active:1};
      export const workspace={isTrusted:true,getConfiguration(){return {get:(k,d)=>d}}};
      export const window={registerWebviewViewProvider(id,p){control.provider=p;return disposable},registerWebviewPanelSerializer(){return disposable},createWebviewPanel(){const s=make();control.editors.push(s);return s},showErrorMessage(){}};
      export const commands={async executeCommand(){if(!control.sidebar.webview.html)control.provider.resolveWebviewView(control.sidebar)}};
    ` }))
  } }] })
  const { ChatSurfaces, PanelBroker, control } = await import(pathToFileURL(outfile).href)
  let receipt: (message: unknown) => void = () => {}
  const surfaces = new ChatSurfaces({ extensionUri: {} }, new PanelBroker(), async (action: {type: string}, reply: typeof receipt) => { if (action.type === "send") receipt = reply }, () => {})
  t.after(() => surfaces.dispose())
  await surfaces.focus(); control.sidebar.receive({ type: "ready" }); control.sidebar.receive({ type: "composerRestore", value: { draft: "original" } })
  assert.doesNotMatch(control.sidebar.webview.html, /id="(?:standaloneActions|newChat|showOutput)"/)
  const appended = surfaces.addContext("code")
  await new Promise(done => setImmediate(done))
  const append = control.sidebar.messages.at(-1)
  assert.equal(append.type, "appendContext")
  control.sidebar.receive({ type: "contextAdded", id: append.id, accepted: true, value: { draft: "original\n\ncode" } })
  await appended
  control.sidebar.receive({ type: "send", text: "original\n\ncode", requestId: "submit-1" })
  surfaces.openInTab(); surfaces.openInTab()
  assert.equal(control.editors.length, 1)
  for (const id of ["standaloneActions", "newChat", "showOutput"]) assert.ok(control.editors[0].webview.html.includes(`id="${id}"`))
  assert.equal(control.sidebar.webview.html, "")
  const editor = control.editors[0]; editor.receive({ type: "ready" }); editor.receive({ type: "composerRestore", value: { draft: "stale saved state" } })
  assert.equal(editor.messages.at(-1).value.draft, "original\n\ncode")
  assert.equal(editor.messages.at(-1).pendingRequestId, "submit-1")
  control.sidebar.receive({ type: "composerChanged", value: { draft: "rogue" } })
  receipt({ type: "sendResult", requestId: "submit-1", accepted: true })
  assert.equal(editor.messages.at(-1).type, "sendResult")
  editor.receive({ type: "composerChanged", value: { draft: "new work" } })
  await surfaces.openInSidebar(); control.sidebar.receive({ type: "ready" }); control.sidebar.receive({ type: "composerRestore", value: { draft: "original" } })
  assert.equal(control.sidebar.messages.at(-1).value.draft, "new work")
  assert.doesNotMatch(control.sidebar.webview.html, /id="(?:standaloneActions|newChat|showOutput)"/)
  control.sidebar.receive({ type: "send", text: "new work", requestId: "submit-2" })
  control.sidebar.receive({ type: "composerChanged", value: { draft: "editing" } })
  control.sidebar.receive({ type: "composerChanged", value: { draft: "new work" } })
  receipt({ type: "sendResult", requestId: "submit-2", accepted: true })
  const movingAppend = surfaces.addContext("next context")
  await new Promise(done => setImmediate(done))
  surfaces.openInTab()
  const movedEditor = control.editors[1]
  movedEditor.receive({ type: "ready" }); movedEditor.receive({ type: "composerRestore", value: { draft: "stale" } })
  const restored = movedEditor.messages.findLast((message: {type: string}) => message.type === "composerDraft")
  assert.equal(restored.value.draft, "new work")
  assert.equal(restored.pendingRequestId, null)
  const replay = movedEditor.messages.at(-1)
  assert.equal(replay.type, "appendContext")
  movedEditor.receive({ type: "contextAdded", id: replay.id, accepted: true, value: { draft: "new work\n\nnext context" } })
  await movingAppend

})
