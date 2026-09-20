import assert from "node:assert/strict"
import { it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

it("editor review previews without writing, applies individual hunks and invalidates stale work", async t => {
  const directory = await mkdtemp(join(tmpdir(), "codem-editor-review-")); t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  const root = process.cwd().endsWith("apps/vscode") ? join(process.cwd(), "../..") : process.cwd()
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: { contents: `export {EditorReview} from './apps/vscode/src/integrations/editorReview.ts';export {control,Range} from 'vscode'`, resolveDir: root }, plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "fixture" }))
    b.onResolve({ filter: /runtimeSession\.ts$/ }, () => ({ path: "runtime", namespace: "fixture" }))
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "runtime" ? "export function assertTrusted(){}" : `
      const disposable={dispose(){}};
      export const control={commands:{},errors:[],info:[],text:'first\\nmiddle\\nsecond',apply:true,writes:0,delayedEvent:false};
      export class EventEmitter {listeners=[];event=fn=>{this.listeners.push(fn);return disposable};fire(value){this.listeners.forEach(fn=>fn(value))}dispose(){}}
      export class Range {constructor(start,end){this.start=start;this.end=end}}
      export class ThemeColor{};export const OverviewRulerLane={Right:1};export const ProgressLocation={Notification:1};
      export const Uri={from:value=>({...value,toString:()=>value.scheme+':'+value.path})};
      export class CodeLens{constructor(range,command){this.range=range;this.command=command}}
      export class MarkdownString{appendText(){return this}appendCodeblock(){return this}}
      export class WorkspaceEdit{edits=[];replace(uri,range,text){this.edits.push({range,text})}}
      control.doc={version:1,isClosed:false,uri:{scheme:'file',path:'/work/a.ts',fsPath:'/work/a.ts',toString:()=>'/work/a.ts'},languageId:'typescript',getText:()=>control.text,offsetAt:position=>position.offset,positionAt:offset=>({offset,line:control.text.slice(0,offset).split('\\n').length-1,character:0})};
      const changed=new EventEmitter(),closed=new EventEmitter();control.changed=changed;control.closed=closed;
      export const workspace={registerTextDocumentContentProvider(s,p){control.provider=p;return disposable},onDidChangeTextDocument:changed.event,onDidCloseTextDocument:closed.event,onDidChangeWorkspaceFolders:()=>disposable,asRelativePath:()=> 'a.ts',async applyEdit(edit){control.writes++;if(!control.apply)return false;for(const e of [...edit.edits].sort((a,b)=>b.range.start.offset-a.range.start.offset))control.text=control.text.slice(0,e.range.start.offset)+e.text+control.text.slice(e.range.end.offset);control.doc.version++;if(!control.delayedEvent)changed.fire({document:control.doc,contentChanges:[{}]});return true},async openTextDocument(uri){return {uri,positionAt:control.doc.positionAt}}};
      export const languages={registerCodeLensProvider(s,p){control.lenses=p;return disposable},async setTextDocumentLanguage(){}};
      export const window=control.window={createTextEditorDecorationType:()=>disposable,visibleTextEditors:[{document:control.doc,setDecorations(){}}],onDidChangeVisibleTextEditors:()=>disposable,showInformationMessage:m=>control.info.push(m),showErrorMessage:m=>control.errors.push(m),async showTextDocument(){},async showQuickPick(){return undefined},async withProgress(o,fn){return fn({}, {isCancellationRequested:false,onCancellationRequested(cb){control.cancel=cb;return disposable}})}};
      export const commands={registerCommand(name,fn){control.commands[name]=fn;return disposable},async executeCommand(...args){control.lastCommand=args}};
    ` }))
  } }] })
  const { EditorReview, control, Range } = await import(pathToFileURL(outfile).href)
  let scope = "scope", ready = true, generateCalls = 0
  const response = JSON.stringify({ edits: [{ before: "first", after: "first expanded\nline", reason: "修改第一处" }, { before: "second", after: "last", reason: "修改第二处" }] })
  let generate = async (_text: string, _signal: AbortSignal) => { generateCalls++; return response }
  const review = new EditorReview({ contextKey: () => scope, ready: () => ready, checkFile: async () => {}, generate: (text: string, signal: AbortSignal) => generate(text, signal) }, () => {})
  t.after(() => review.dispose())
  const reset = () => { control.text = "first\nmiddle\nsecond"; control.doc.version++; control.changed.fire({ document: control.doc, contentChanges: [{}] }) }
  const propose = () => review.generate("fixCode", control.doc, new Range({ offset: 0 }, { offset: control.text.length }), [])
  const lenses = () => control.lenses.provideCodeLenses(control.doc)
  await propose(); assert.equal(control.writes, 0); assert.equal(lenses().length, 6)
  let first = lenses()[0].command.arguments
  await control.commands['codem.previewEdit'](...first)
  assert.equal(control.lastCommand[0], "vscode.diff")
  assert.equal(control.provider.provideTextDocumentContent(control.lastCommand[2]), "first expanded\nline\nmiddle\nlast")
  await control.commands['codem.acceptEdit'](...first)
  assert.equal(control.text, "first expanded\nline\nmiddle\nsecond"); assert.equal(lenses().length, 3)
  assert.equal(lenses()[0].range.start.offset, control.text.indexOf("second"))
  await control.commands['codem.rejectEdit'](...lenses()[0].command.arguments)
  assert.equal(control.text, "first expanded\nline\nmiddle\nsecond"); assert.equal(lenses().length, 0)
  const writes = control.writes
  await control.commands['codem.acceptEdit'](...first); assert.equal(control.writes, writes)
  reset(); await propose(); first = lenses()[0].command.arguments
  control.text += " user edit"; control.doc.version++; control.changed.fire({ document: control.doc, contentChanges: [{}] })
  await control.commands['codem.acceptEdit'](...first); assert.equal(control.writes, writes)
  reset(); await propose(); scope = "other"; review.contextChanged(); assert.equal(lenses().length, 0)
  reset(); await propose(); control.apply = false
  await control.commands['codem.acceptAllEdits'](); assert.equal(lenses().length, 6)
  control.apply = true; await control.commands['codem.acceptAllEdits'](); assert.equal(control.text, "first expanded\nline\nmiddle\nlast")
  reset(); await propose(); await control.commands['codem.rejectAllEdits'](); assert.equal(control.text, "first\nmiddle\nsecond")
  reset(); await propose(); ready = false; review.contextChanged()
  assert.equal(lenses().length, 6, "temporary model work must retain pending review")
  const busyWrites = control.writes
  await control.commands['codem.acceptAllEdits']()
  assert.equal(control.writes, busyWrites); assert.equal(lenses().length, 6)
  ready = true
  control.window.activeTextEditor = { document: control.doc, selection: { active: { line: 0 } } }
  control.delayedEvent = true
  await control.commands['codem.acceptCurrentEdit']()
  control.changed.fire({ document: control.doc, contentChanges: [{}] })
  assert.equal(control.text, "first expanded\nline\nmiddle\nsecond"); assert.equal(lenses().length, 3)
  control.delayedEvent = false
  control.window.activeTextEditor.selection.active.line = 3
  await control.commands['codem.rejectCurrentEdit'](); assert.equal(lenses().length, 0)
  const beforeCancel = generateCalls
  generate = (_text, signal) => new Promise((_, reject) => { generateCalls++; signal.addEventListener("abort", () => reject(new Error("aborted")), {once:true}) })
  const pending = propose(); await new Promise(done => setImmediate(done))
  await assert.rejects(propose(), /正在生成/)
  control.cancel(); await pending; assert.equal(generateCalls, beforeCancel + 1); assert.equal(lenses().length, 0)
  ready = false; await assert.rejects(propose(), /请先连接/)
})
