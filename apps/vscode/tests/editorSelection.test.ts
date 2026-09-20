import assert from "node:assert/strict"
import { it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

it("observes selections locally, preserves chat focus, and sends exactly the displayed source", async t => {
  const directory = await mkdtemp(join(tmpdir(), "codem-selection-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: {
    contents: `export { EditorSelection } from './apps/vscode/src/integrations/editorSelection.ts'; export { control, window } from 'vscode';`, resolveDir: fileURLToPath(new URL("../../..", import.meta.url)),
  }, plugins: [{ name: "selectionFixture", setup(b) {
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "fixture" }))
    b.onResolve({ filter: /runtimeSession\.ts$/ }, () => ({ path: "trust", namespace: "fixture" }))
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "trust" ? `import {control} from 'vscode'; export function assertTrusted(){if(!control.trusted) throw Error('untrusted')}` : `
      export const control = {events:{},trusted:true,disposed:0,revealed:null};
      const listen = key => fn => {control.events[key]=fn; return {dispose(){control.disposed++}}};
      export const Uri = {parse:value=>({scheme:value.startsWith('file:')?'file':'untitled',fsPath:value.replace('file://',''),toString:()=>value})};
      export class Range {constructor(startLine,startCharacter,endLine,endCharacter){Object.assign(this,{startLine,startCharacter,endLine,endCharacter})}}
      const document = {uri:Uri.parse('file:///workspace/code.ts'),fileName:'/workspace/code.ts',version:1,languageId:'typescript',getText(){return 'const a = 1\\n'}};
      export const window = {activeTextEditor:{document,selection:{isEmpty:false,start:{line:9,character:0},end:{line:15,character:0}}},onDidChangeTextEditorSelection:listen('selection'),onDidChangeActiveTextEditor:listen('active'),async showTextDocument(document,options){control.revealed=options}};
      export const workspace = {get isTrusted(){return control.trusted},getWorkspaceFolder(){return {}},asRelativePath(){return 'src/code.ts'},onDidChangeTextDocument:listen('change'),onDidCloseTextDocument:listen('close'),async openTextDocument(){return document}};
    ` }))
  } }] })
  const { EditorSelection, control, window } = await import(pathToFileURL(outfile).href)
  const views: unknown[] = []
  const selection = new EditorSelection((view: unknown) => views.push(view))
  t.after(() => selection.dispose())
  const editor = window.activeTextEditor
  const first = selection.state.snapshot().current
  assert.equal(first.startLine, 10)
  assert.equal(first.endLine, 15, "An exclusive endpoint at column zero excludes that line")
  window.activeTextEditor = undefined
  control.events.active(undefined)
  assert.deepEqual(selection.state.snapshot().current, first, "Focusing the Webview preserves the selection")
  await selection.reveal(first.id)
  assert.equal(control.revealed.selection.endLine, 15)
  const sent: string[] = []
  const validated: string[] = []
  const validate = async (path: string) => { validated.push(path) }
  assert.equal(await selection.send("explain", [first.id], async (text: string) => { sent.push(text); return false }, validate), false)
  assert.equal(selection.state.snapshot().current.id, first.id, "Failure retains the reference")
  assert.match(sent[0]!, /src\/code.ts:10-15[\s\S]*const a = 1\n/)
  assert.deepEqual(validated, ["/workspace/code.ts"])
  window.activeTextEditor = editor
  control.events.active(editor)
  assert.equal(views.length, 1, "Repeated focus does not create a new reference")
  let finish!: (accepted: boolean) => void
  const sending = selection.send("next", [first.id], () => new Promise<boolean>(resolve => { finish = resolve }), validate)
  await new Promise(resolve => setImmediate(resolve))
  editor.selection.end.character = 2
  control.events.selection({ textEditor: editor })
  const newer = selection.state.snapshot().current
  assert.equal(newer.endLine, 16)
  finish(true)
  await sending
  assert.equal(selection.state.snapshot().current.id, newer.id, "The old receipt must not remove a newer selection")
  await assert.rejects(selection.send("stale", [first.id], async () => { throw Error("must not send") }, validate), /选区已变化/)
  assert.equal(await selection.send("ok", [newer.id], async () => true, validate), true)
  assert.equal(selection.state.snapshot().current, null)
  control.events.active(editor)
  assert.equal(selection.state.snapshot().current, null, "Successful send does not reattach on focus")
  editor.document.version++
  control.events.selection({ textEditor: editor })
  control.events.change({ document: editor.document, contentChanges: [{}] })
  assert.equal(selection.state.snapshot().current, null, "Source edits invalidate a stale selection")
  editor.document.version++
  control.events.selection({ textEditor: editor })
  control.events.close(editor.document)
  assert.equal(selection.state.snapshot().current, null)
  editor.document.version++
  control.events.selection({ textEditor: editor })
  const pinnedId = selection.state.snapshot().current.id
  selection.state.pin(pinnedId)
  editor.document.version++
  control.events.change({ document: editor.document, contentChanges: [{}] })
  control.events.close(editor.document)
  assert.equal(selection.state.snapshot().pinned.length, 1, "Fixed snapshots survive document edits and close")
  await assert.rejects(selection.reveal(pinnedId), /源文件已变化/)
  assert.equal(selection.state.snapshot().pinned.length, 1, "Failed navigation must retain the fixed snapshot")
  editor.document.version++
  control.events.selection({ textEditor: editor })
  const liveId = selection.state.snapshot().current.id
  await assert.rejects(selection.reveal(pinnedId), /源文件已变化/)
  assert.equal(selection.state.snapshot().current.id, liveId, "An old pinned reference cannot invalidate the newer live selection")
  const beforeValidation = validated.length
  assert.equal(await selection.send("compare", [pinnedId, liveId], async () => false, validate), false)
  assert.equal(validated.length - beforeValidation, 1, "Validate a shared source path only once")
  assert.equal(selection.state.snapshot().pinned.length, 1)
  assert.equal(selection.state.snapshot().current.id, liveId)
  await assert.rejects(selection.send("failure", [pinnedId, liveId], async () => { throw Error("offline") }, validate), /offline/)
  assert.equal(selection.state.snapshot().pinned.length, 1)
  await assert.rejects(selection.send("workspace", [pinnedId], async () => { throw Error("must not send") }, async () => { throw Error("outside workspace") }), /outside workspace/)
  assert.equal(selection.state.snapshot().pinned.length, 1)
  let finishPinned!: (accepted: boolean) => void
  const pending = selection.send("both", [pinnedId, liveId], () => new Promise<boolean>(resolve => { finishPinned = resolve }), validate)
  await new Promise(resolve => setImmediate(resolve))
  editor.document.version++
  control.events.selection({ textEditor: editor })
  const laterId = selection.state.snapshot().current.id
  selection.state.pin(laterId)
  finishPinned(true)
  await pending
  assert.deepEqual(selection.state.snapshot().pinned.map((item: { id: string }) => item.id), [laterId], "Receipt only consumes submitted references")
  await assert.rejects(selection.send("removed while validating", [laterId], async () => { throw Error("must not send") }, async () => { selection.state.remove(laterId) }), /选区已变化/)
  selection.state.clear()
  control.trusted = false
  control.events.active(editor)
  assert.equal(selection.state.snapshot().current, null, "Untrusted source is not attached")
})
