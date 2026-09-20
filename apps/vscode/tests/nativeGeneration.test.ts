import assert from "node:assert/strict"
import { it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

it("native generators reject automatic completions, stale documents, changed staged diffs and edited SCM input", async t => {
  const directory = await mkdtemp(join(tmpdir(), "codem-native-generation-")); t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  const root = process.cwd().endsWith("apps/vscode") ? join(process.cwd(), "../..") : process.cwd()
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: { contents: `export { registerGitActions } from './apps/vscode/src/integrations/gitActions.ts'; export { registerInlineCompletion } from './apps/vscode/src/integrations/inlineCompletion.ts'; export { control } from 'vscode';`, resolveDir: root }, plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "fixture" }))
    b.onResolve({ filter: /runtimeSession\.ts$/ }, () => ({ path: "runtime", namespace: "fixture" }))
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "runtime" ? "export function assertTrusted(){}" : `
      const disposable={dispose(){}};const event=()=>disposable;
      export const control={commands:{}, errors:[], provider:null, diff:'+new', editor:null, changes:0, historyCalls:0, historyError:false, historyWait:null, cancel:null};
      const uri={scheme:'file',fsPath:'/workspace/file.ts',toString:()=>'/workspace'};
      const position={line:0,character:3,isEqual(other){return other.line===0&&other.character===3}};
      const document={uri,version:1,isClosed:false,languageId:'typescript',offsetAt:()=>3,positionAt:n=>({line:0,character:n}),getText:()=> 'foo'};
      control.editor={document,selection:{isEmpty:true,active:position}};
      control.position=position;
      control.repo={rootUri:uri,inputBox:{value:''},state:{HEAD:{commit:'head-1'}},async diff(){if(control.diffWait)await control.diffWait;return control.diff},async log(options){control.historyCalls++;control.logOptions=options;if(control.historyWait)await control.historyWait;if(control.historyError)throw new Error('Cannot read commit history');return [{message:'fix(chat): preserve drafts\\n\\nOld feature must not appear in output'}]}};
      export const workspace={isTrusted:true,getWorkspaceFolder:()=>({}),getConfiguration:()=>({get:()=>true}),onDidChangeTextDocument:event,onDidChangeConfiguration:event};
      export const window={get activeTextEditor(){return control.editor},onDidChangeActiveTextEditor:event,onDidChangeTextEditorSelection:event,showQuickPick:async items=>items[0],showWarningMessage:async()=> '替换',showInformationMessage(){},showErrorMessage:m=>control.errors.push(m),async withProgress(opts,callback){return callback({}, {onCancellationRequested:callback=>{control.cancel=callback;return disposable}})},createStatusBarItem:()=>({show(){},hide(){},dispose(){}})};
      export const commands={registerCommand(name,fn){control.commands[name]=fn;return disposable},executeCommand:async()=>{}};
      export const extensions={getExtension:()=>({isActive:true,exports:{enabled:true,getAPI:()=>({repositories:[control.repo]})}})};
      export const languages={registerInlineCompletionItemProvider(filter,p){control.provider=p;return disposable}};
      export const Disposable={from(){return disposable}};
      export const env={language:'zh-cn'};export const ProgressLocation={Notification:1};export const StatusBarAlignment={Right:1};export const InlineCompletionTriggerKind={Invoke:0,Automatic:1};
      export class Range{constructor(start,end){this.start=start;this.end=end}}
      export class InlineCompletionItem{constructor(insertText,range){this.insertText=insertText;this.range=range}}
    ` }))
  } }] })
  const { registerGitActions, registerInlineCompletion, control } = await import(pathToFileURL(outfile).href)
  let resolve: (text: string) => void = () => {}; let calls = 0; let prompt = ""; let scope = "scope"
  const chat = { contextKey: () => scope, assertContextWorkspace: async () => {}, assertContextDirectory: async () => {}, snapshot: () => ({ phase: "ready" }), generateText: (text: string) => { calls++; prompt = text; return new Promise<string>(done => { resolve = done }) } }
  registerGitActions(chat, () => {}); registerInlineCompletion(chat, () => {})
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }
  const doc = control.editor.document
  assert.deepEqual(await control.provider.provideInlineCompletionItems(doc, control.position, { triggerKind: 1 }, token), [])
  assert.equal(calls, 0)
  const completion = control.provider.provideInlineCompletionItems(doc, control.position, { triggerKind: 0 }, token)
  await new Promise(done => setImmediate(done)); doc.version++
  resolve('{"insertText":"bar"}')
  assert.deepEqual(await completion, [])
  const success = control.provider.provideInlineCompletionItems(doc, control.position, { triggerKind: 0 }, token)
  await new Promise(done => setImmediate(done)); resolve('{"insertText":"bar"}')
  assert.equal((await success)[0].insertText, "bar")
  const edited = control.commands['codem.generateCommitMessage']()
  await new Promise(done => setImmediate(done)); control.repo.inputBox.value = "user work"; resolve('{"message":"generated"}')
  await edited; assert.equal(control.repo.inputBox.value, "user work")
  const changed = control.commands['codem.generateCommitMessage']()
  await new Promise(done => setImmediate(done)); control.diff = '+different'; resolve('{"message":"generated"}')
  await changed; assert.equal(control.repo.inputBox.value, "user work")
  const commit = control.commands['codem.generateCommitMessage']()
  await new Promise(done => setImmediate(done)); scope = "first-created-thread"; resolve('{"message":"generated"}')
  await commit; assert.equal(control.repo.inputBox.value, "generated")
  assert.equal(control.errors.length, 2)
  assert.deepEqual(control.logOptions, { maxEntries: 8, maxParents: 1, range: "head-1" })
  assert.match(prompt, /fix\(chat\): preserve drafts/)
  assert.doesNotMatch(prompt, /Old feature must not appear/)
  assert.match(prompt, /\+different/)
  // HEAD changes invalidate style/evidence even if the staged diff happens to be identical.
  const switched = control.commands['codem.generateCommitMessage']()
  await new Promise(done => setImmediate(done)); control.repo.state.HEAD.commit = "head-2"; resolve('{"message":"stale"}')
  await switched; assert.equal(control.repo.inputBox.value, "generated")
  let releaseDiff: () => void = () => {}
  const verifying = control.commands['codem.generateCommitMessage']()
  await new Promise(done => setImmediate(done))
  control.diffWait = new Promise<void>(done => { releaseDiff = done })
  resolve('{"message":"old session result"}')
  await new Promise(done => setImmediate(done)); scope = "another-thread"; releaseDiff(); await verifying
  assert.equal(control.repo.inputBox.value, "generated")
  control.diffWait = null
  const beforeEmpty = calls, historyBeforeEmpty = control.historyCalls
  control.diff = ""
  await control.commands['codem.generateCommitMessage']()
  assert.equal(calls, beforeEmpty); assert.equal(control.historyCalls, historyBeforeEmpty)
  control.diff = "+new"
  control.historyError = true
  await control.commands['codem.generateCommitMessage']()
  assert.equal(calls, beforeEmpty); assert.equal(control.repo.inputBox.value, "generated")
  control.historyError = false
  // Cancel while local history is pending: no expensive model request or input replacement.
  let releaseHistory: () => void = () => {}
  control.historyWait = new Promise<void>(done => { releaseHistory = done })
  const cancelled = control.commands['codem.generateCommitMessage']()
  await new Promise(done => setImmediate(done)); control.cancel(); releaseHistory(); await cancelled
  assert.equal(calls, beforeEmpty); assert.equal(control.repo.inputBox.value, "generated")
  control.historyWait = null
  const historyBeforeUnborn = control.historyCalls
  control.repo.state.HEAD = undefined
  const unborn = control.commands['codem.generateCommitMessage']()
  await new Promise(done => setImmediate(done)); resolve('{"message":"Add initial files"}'); await unborn
  assert.equal(control.historyCalls, historyBeforeUnborn)
  assert.match(prompt, /风格样本）：\[\]/)
  assert.equal(control.repo.inputBox.value, "Add initial files")
})
