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
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: { contents: `export { registerGitActions } from './apps/vscode/src/gitActions.ts'; export { registerInlineCompletion } from './apps/vscode/src/inlineCompletion.ts'; export { control } from 'vscode';`, resolveDir: root }, plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "fixture" }))
    b.onResolve({ filter: /runtimeSession\.ts$/ }, () => ({ path: "runtime", namespace: "fixture" }))
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "runtime" ? "export function assertTrusted(){}" : `
      const disposable={dispose(){}};const event=()=>disposable;
      export const control={commands:{}, errors:[], provider:null, diff:'+new', editor:null, changes:0};
      const uri={scheme:'file',fsPath:'/workspace/file.ts',toString:()=>'/workspace'};
      const position={line:0,character:3,isEqual(other){return other.line===0&&other.character===3}};
      const document={uri,version:1,isClosed:false,languageId:'typescript',offsetAt:()=>3,positionAt:n=>({line:0,character:n}),getText:()=> 'foo'};
      control.editor={document,selection:{isEmpty:true,active:position}};
      control.position=position;
      control.repo={rootUri:uri,inputBox:{value:''},async diff(){return control.diff}};
      export const workspace={isTrusted:true,getWorkspaceFolder:()=>({}),getConfiguration:()=>({get:()=>true}),onDidChangeTextDocument:event,onDidChangeConfiguration:event};
      export const window={get activeTextEditor(){return control.editor},onDidChangeActiveTextEditor:event,onDidChangeTextEditorSelection:event,showQuickPick:async items=>items[0],showWarningMessage:async()=> '替换',showInformationMessage(){},showErrorMessage:m=>control.errors.push(m),async withProgress(opts,callback){return callback({}, {onCancellationRequested:event})},createStatusBarItem:()=>({show(){},hide(){},dispose(){}})};
      export const commands={registerCommand(name,fn){control.commands[name]=fn;return disposable},executeCommand:async()=>{}};
      export const extensions={getExtension:()=>({isActive:true,exports:{enabled:true,getAPI:()=>({repositories:[control.repo]})}})};
      export const languages={registerInlineCompletionItemProvider(filter,p){control.provider=p;return disposable}};
      export const Disposable={from(){return disposable}};
      export const ProgressLocation={Notification:1};export const StatusBarAlignment={Right:1};export const InlineCompletionTriggerKind={Invoke:0,Automatic:1};
      export class Range{constructor(start,end){this.start=start;this.end=end}}
      export class InlineCompletionItem{constructor(insertText,range){this.insertText=insertText;this.range=range}}
    ` }))
  } }] })
  const { registerGitActions, registerInlineCompletion, control } = await import(pathToFileURL(outfile).href)
  let resolve: (text: string) => void = () => {}; let calls = 0
  const chat = { contextKey: () => "scope", assertContextWorkspace: async () => {}, assertContextDirectory: async () => {}, snapshot: () => ({ phase: "ready" }), generateText: () => { calls++; return new Promise<string>(done => { resolve = done }) } }
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
  await new Promise(done => setImmediate(done)); resolve('{"message":"generated"}')
  await commit; assert.equal(control.repo.inputBox.value, "generated")
  assert.equal(control.errors.length, 2)
})
