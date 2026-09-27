import assert from "node:assert/strict"
import { it, type TestContext } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "codem-surfaces-")); t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: { contents: `export { ChatSurfaces } from './apps/vscode/src/chat/chatSurfaces.ts'; export { PanelBroker } from './apps/vscode/src/panels/panelBroker.ts'; export { control } from 'vscode';`, resolveDir: process.cwd().endsWith("apps/vscode") ? join(process.cwd(), "../..") : process.cwd() }, plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "fixture" }))
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      const disposable = {dispose(){}};
      function surface(){
        let listener;let closed;let html='';let htmlWrites=0;const visibilityListeners=new Set();
        const onVisibility=fn=>{visibilityListeners.add(fn);return {dispose(){visibilityListeners.delete(fn)}}};
        return {messages:[],visible:true,get htmlWrites(){return htmlWrites},get listenerCount(){return visibilityListeners.size},
          webview:{get html(){return html},set html(value){html=value;htmlWrites++},cspSource:'fixture',postMessage(m){this.owner.messages.push(m);return Promise.resolve(true)},asWebviewUri(){return {toString:()=>''}},onDidReceiveMessage(fn){listener=fn;return {dispose(){listener=undefined}}}},
          onDidChangeVisibility:onVisibility,onDidChangeViewState:onVisibility,
          setVisible(value){this.visible=value;for(const fn of visibilityListeners)fn({webviewPanel:this})},
          onDidDispose(fn){closed=fn;return disposable},show(preserveFocus){this.preserveFocus=preserveFocus;this.setVisible(true)},reveal(column,preserveFocus){this.preserveFocus=preserveFocus;this.setVisible(true)},dispose(){closed?.()},receive(m){listener?.(m)}
        }
      }
      function make(){const s=surface();s.webview.owner=s;return s}
      export const control={contexts:[],sidebar:make(),editors:[],provider:null,providerOptions:null,serializer:null,configuration:null,settings:{}};
      export const Uri={joinPath(){return {}}};
      export const ViewColumn={Active:1};
      export const workspace={isTrusted:true,getConfiguration(){return {get:(k,d)=>control.settings[k]??d}},onDidChangeConfiguration(fn){control.configuration=fn;return disposable}};
      export const window={registerWebviewViewProvider(id,p,options){control.provider=p;control.providerOptions=options;return disposable},registerWebviewPanelSerializer(id,serializer){control.serializer=serializer;return disposable},createWebviewPanel(id,title,column,options){const s=make();delete s.onDidChangeVisibility;s.options=options;control.editors.push(s);return s},showErrorMessage(){}};
      export const commands={async executeCommand(name,key,value){if(name==='setContext'){control.contexts.push([key,value]);return}if(!control.sidebar.webview.html)control.provider.resolveWebviewView(control.sidebar)}};
    ` }))
  } }] })
  return import(pathToFileURL(outfile).href)
}
/** The entry creates the container first and serves it once its handlers exist. */
function serve<T extends { serve(handlers: object): void }>(surfaces: T, dispatch: (action: never, reply: never) => Promise<void>, publish: () => void): T {
  surfaces.serve({ dispatch, publish })
  return surfaces
}

it("registers the sidebar and editor restore only when served, once, and reposts a changed send key", async t => {
  const { ChatSurfaces, PanelBroker, control } = await fixture(t)
  const surfaces = new ChatSurfaces({ extensionUri: {} }, new PanelBroker())
  t.after(() => surfaces.dispose())
  assert.equal(control.provider, null, "Nothing can mount before the handlers exist")
  assert.equal(control.serializer, null)
  const actions: string[] = []
  surfaces.serve({ dispatch: async (action: { type: string }) => { actions.push(action.type) }, publish() {} })
  assert.ok(control.provider)
  assert.ok(control.serializer)
  assert.throws(() => surfaces.serve({ dispatch: async () => {}, publish() {} }), /already served/)
  await surfaces.focus(); control.sidebar.receive({ type: "ready" })
  assert.deepEqual(actions, ["ready"])
  control.settings["chat.sendKey"] = "ctrlEnter"
  control.sidebar.messages.length = 0
  control.configuration({ affectsConfiguration: (key: string) => key === "codem.autoConnect" })
  assert.equal(control.sidebar.messages.length, 0, "Other settings do not repost editor settings")
  control.configuration({ affectsConfiguration: (key: string) => key === "codem.chat.sendKey" })
  assert.deepEqual(control.sidebar.messages, [{ type: "editorSettings", sendKey: "ctrlEnter" }])
})

it("moves one chat surface, preserves draft and pending sends, reuses the editor and rejects old surface messages", async t => {
  const { ChatSurfaces, PanelBroker, control } = await fixture(t)
  let receipt: (message: unknown) => void = () => {}
  const surfaces = serve(new ChatSurfaces({ extensionUri: {} }, new PanelBroker()), async (action: {type: string}, reply: typeof receipt) => { if (action.type === "send") receipt = reply }, () => {})
  t.after(() => surfaces.dispose())
  await surfaces.focus(); control.sidebar.receive({ type: "ready" }); control.sidebar.receive({ type: "composerRestore", value: { draft: "original" } })
  assert.match(control.sidebar.webview.html, /id="codem-root" data-surface="sidebar"/)
  const appended = surfaces.addContext("code")
  await new Promise(done => setImmediate(done))
  const append = control.sidebar.messages.at(-1)
  assert.equal(append.type, "appendContext")
  control.sidebar.receive({ type: "contextAdded", id: append.id, accepted: true, value: { draft: "original\n\ncode" } })
  await appended
  control.sidebar.receive({ type: "send", text: "original\n\ncode", requestId: "submit-1" })
  surfaces.openInTab(); surfaces.openInTab()
  assert.equal(control.editors.length, 1)
  assert.equal(control.sidebar.listenerCount, 0, "Moving the page detaches its visibility listener")
  // React renders the controls; the host owns the root and surface identity.
  assert.match(control.editors[0].webview.html, /id="codem-root" data-surface="editor"/)
  assert.match(control.editors[0].webview.html, /<script nonce="[^"]+" src=/)
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
  assert.match(control.sidebar.webview.html, /id="codem-root" data-surface="sidebar"/)
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

for (const location of ["sidebar", "editor"] as const) {
  it(`retains ${location} across hide/reveal and synchronizes without remounting or reconnecting`, async t => {
    const { ChatSurfaces, PanelBroker, control } = await fixture(t)
    const panels = new PanelBroker()
    const actions: string[] = []
    let phase = "ready"
    let publications = 0
    const surfaces = serve(new ChatSurfaces({ extensionUri: {} }, panels), async (action: { type: string }) => { actions.push(action.type) }, () => {
      publications++
      surfaces.post({ type: "state", phase })
    })
    t.after(() => surfaces.dispose())
    await surfaces.focus()
    if (location === "editor") surfaces.openInTab()
    const surface = location === "sidebar" ? control.sidebar : control.editors[0]
    assert.equal(location === "sidebar" ? control.providerOptions.webviewOptions.retainContextWhenHidden : surface.options.retainContextWhenHidden, true)
    surface.setVisible(false); surface.setVisible(true)
    assert.equal(publications, 0, "Visibility cannot publish before the page handshake")
    surface.receive({ type: "ready" })
    surface.receive({ type: "composerRestore", value: { draft: "keep my draft" } })
    const html = surface.webview.html
    const writes = surface.htmlWrites
    const decision = panels.request({ kind: "approval", title: "确认操作", choices: [{ value: "yes", label: "允许" }] })
    const panelId = surface.messages.at(-1).panel.id
    for (let index = 0; index < 3; index++) {
      surface.setVisible(false)
      const before: number = publications
      surface.messages.length = 0
      phase = index === 1 ? "disconnected" : "ready"
      surface.setVisible(true)
      assert.equal(publications, before + 1)
      assert.deepEqual(surface.messages.find((message: { type: string }) => message.type === "state"), { type: "state", phase })
      assert.equal(surface.messages.find((message: { type: string }) => message.type === "panel").panel.id, panelId)
      assert.equal(surface.messages.some((message: { type: string }) => message.type === "composerDraft"), false, "Reveal must not overwrite caret, edits or pending input")
      assert.equal(surface.webview.html, html)
      assert.equal(surface.htmlWrites, writes)
      assert.deepEqual(actions, ["ready"], "Reveal must not dispatch initialization or any runtime request")
      surface.setVisible(true)
      assert.equal(publications, before + 1, "Focus changes within a visible editor do not resynchronize")
    }
    surface.setVisible(false)
    panels.cancel()
    assert.equal(await decision, null)
    surface.messages.length = 0
    surface.setVisible(true)
    assert.equal(surface.messages.find((message: { type: string }) => message.type === "panel").panel, null, "Canceled decisions must not return on reveal")
    const beforeDispose = publications
    surfaces.dispose()
    assert.equal(surface.listenerCount, 0)
    surface.setVisible(false); surface.setVisible(true); surface.receive({ type: "ready" })
    assert.equal(publications, beforeDispose)
  })
}

it("replays an explicit page reload from Host without changing its connection or draft", async t => {
  const { ChatSurfaces, PanelBroker, control } = await fixture(t)
  let publications = 0
  const surfaces = serve(new ChatSurfaces({ extensionUri: {} }, new PanelBroker()), async () => {}, () => { publications++ })
  t.after(() => surfaces.dispose())
  await surfaces.focus()
  const sidebar = control.sidebar
  sidebar.receive({ type: "ready" })
  sidebar.receive({ type: "composerRestore", value: { draft: "current draft" } })
  const writes = sidebar.htmlWrites
  control.provider.resolveWebviewView(sidebar)
  assert.equal(sidebar.htmlWrites, writes, "Repeated provider resolution must not replace a live document")
  assert.equal(sidebar.listenerCount, 1)
  sidebar.receive({ type: "ready" })
  sidebar.receive({ type: "composerRestore", value: { draft: "stale saved draft" } })
  assert.equal(publications, 2)
  assert.equal(sidebar.messages.at(-1).value.draft, "current draft")
})

it("logout clears pending context and saved drafts so surface reload cannot restore old account input", async t => {
  const { ChatSurfaces, PanelBroker, control } = await fixture(t)
  const surfaces = serve(new ChatSurfaces({ extensionUri: {} }, new PanelBroker()), async () => {}, () => {})
  t.after(() => surfaces.dispose())
  await surfaces.focus(); control.sidebar.receive({ type: "ready" }); control.sidebar.receive({ type: "composerRestore", value: { draft: "old account draft" } })
  const insertion = surfaces.addContext("old context")
  const rejected = assert.rejects(insertion, /无法加入上下文/)
  await new Promise(resolve => setImmediate(resolve))
  const oldInsertion = control.sidebar.messages.at(-1)
  surfaces.resetDraft(); await rejected
  control.sidebar.receive({ type: "contextAdded", id: oldInsertion.id, accepted: true, value: { draft: "late old content" } })
  surfaces.openInTab()
  const editor = control.editors[0]
  editor.receive({ type: "ready" }); editor.receive({ type: "composerRestore", value: { draft: "stale persisted content" } })
  assert.equal(editor.messages.at(-1).value.draft, "")
  assert.equal(editor.messages.at(-1).pendingRequestId, null)
})

it("logout cancels context insertion waiting for Webview restoration", async t => {
  const { ChatSurfaces, PanelBroker, control } = await fixture(t)
  const surfaces = serve(new ChatSurfaces({ extensionUri: {} }, new PanelBroker()), async () => {}, () => {})
  t.after(() => surfaces.dispose())
  const insertion = surfaces.addContext("previous account code")
  const rejected = assert.rejects(insertion, /上下文已取消/)
  await new Promise(resolve => setImmediate(resolve))
  surfaces.resetDraft(); await rejected
  control.sidebar.receive({ type: "ready" }); control.sidebar.receive({ type: "composerRestore", value: { draft: "stale" } })
  assert.equal(control.sidebar.messages.some((message: { type: string }) => message.type === "appendContext"), false)
  assert.equal(control.sidebar.messages.at(-1).value.draft, "")
})

it("opens the permission menu after readiness with keyboard focus, once, and lets a later request replace it", async t => {
  const { ChatSurfaces, PanelBroker, control } = await fixture(t)
  const surfaces = serve(new ChatSurfaces({ extensionUri: {} }, new PanelBroker()), async () => {}, () => {})
  t.after(() => surfaces.dispose())
  const opened = () => control.sidebar.messages.filter((message: { type: string }) => message.type === "openPermissionMenu").length
  await surfaces.focus()
  await surfaces.openPermissionMenu(); await surfaces.openPermissionMenu()
  assert.equal(control.sidebar.messages.length, 0, "Nothing posts before the page is ready")
  control.sidebar.receive({ type: "ready" })
  assert.equal(opened(), 1)
  control.sidebar.receive({ type: "composerRestore", value: { draft: "" } })
  assert.equal(control.sidebar.messages.at(-1).focus, false, "Focusing the composer would close the menu")
  control.sidebar.setVisible(false); control.sidebar.setVisible(true)
  assert.equal(opened(), 1, "Revealing the surface must not reopen a closed menu")
  await surfaces.openPermissionMenu()
  assert.equal(opened(), 2)
  surfaces.openInTab()
  await surfaces.openPermissionMenu()
  const editor = control.editors[0]
  assert.equal(editor.preserveFocus, false, "The menu needs the page to hold keyboard focus")
  await surfaces.openAccount()
  editor.receive({ type: "ready" })
  assert.deepEqual(editor.messages.map((message: { type: string }) => message.type).filter((type: string) => type === "showAccount" || type === "openPermissionMenu"), ["showAccount"], "The latest request replaces a pending menu")
  await surfaces.openPermissionMenu(); await surfaces.focus()
  assert.equal(editor.messages.at(-1).type, "focusComposer")
})

it("scopes chat keybindings to page focus, which focusedView misses inside the sidebar Webview", async t => {
  const { ChatSurfaces, PanelBroker, control } = await fixture(t)
  const surfaces = serve(new ChatSurfaces({ extensionUri: {} }, new PanelBroker()), async () => {}, () => {})
  await surfaces.focus(); control.sidebar.receive({ type: "ready" })
  control.sidebar.receive({ type: "chatFocus", focused: true }); control.sidebar.receive({ type: "chatFocus", focused: true })
  assert.deepEqual(control.contexts, [["codem.chatFocused", true]], "Repeated focus reports set the context once")
  control.sidebar.setVisible(false)
  assert.deepEqual(control.contexts.at(-1), ["codem.chatFocused", false], "Hiding the view clears it")
  control.sidebar.setVisible(true); control.sidebar.receive({ type: "chatFocus", focused: true })
  surfaces.openInTab()
  assert.deepEqual(control.contexts.at(-1), ["codem.chatFocused", false], "Moving the chat clears the old page's focus")
  control.sidebar.receive({ type: "chatFocus", focused: true })
  assert.deepEqual(control.contexts.at(-1), ["codem.chatFocused", false], "A detached page cannot claim focus")
  control.editors[0].receive({ type: "chatFocus", focused: true })
  surfaces.dispose()
  assert.deepEqual(control.contexts.at(-1), ["codem.chatFocused", false])
})

it("opens account after readiness, once, without stealing focus when the draft restores", async t => {
  const { ChatSurfaces, PanelBroker, control } = await fixture(t)
  const surfaces = serve(new ChatSurfaces({ extensionUri: {} }, new PanelBroker()), async () => {}, () => surfaces.post({ type: "account", state: { status: "signedIn" } }))
  t.after(() => surfaces.dispose())
  await surfaces.focus()
  await surfaces.openAccount(); await surfaces.openAccount()
  assert.equal(control.sidebar.messages.length, 0)
  assert.equal(control.sidebar.preserveFocus, true)
  control.sidebar.receive({ type: "ready" })
  assert.equal(control.sidebar.messages.at(-1).type, "showAccount")
  assert.equal(control.sidebar.messages.filter((message: { type: string }) => message.type === "showAccount").length, 1)
  control.sidebar.receive({ type: "composerRestore", value: { draft: "keep this" } })
  assert.equal(control.sidebar.messages.at(-1).focus, false)
  assert.equal(control.sidebar.messages.at(-1).value.draft, "keep this")
  control.sidebar.setVisible(false); control.sidebar.setVisible(true)
  assert.equal(control.sidebar.messages.filter((message: { type: string }) => message.type === "showAccount").length, 1, "Revealing the surface must not reopen a closed account page")
  surfaces.openInTab()
  await surfaces.openAccount()
  const editor = control.editors[0]
  editor.receive({ type: "ready" })
  assert.equal(editor.messages.at(-1).type, "showAccount")
  editor.receive({ type: "composerRestore", value: { draft: "stale" } })
  assert.equal(editor.messages.at(-1).focus, false)
  assert.equal(editor.messages.at(-1).value.draft, "keep this")
  await surfaces.openAccount()
  assert.equal(editor.preserveFocus, true)
  assert.equal(editor.messages.at(-1).type, "showAccount")
})
