import assert from "node:assert/strict"
import { it, type TestContext } from "node:test"
import { build } from "esbuild"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "codem-completion-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: { contents: `export { registerInlineCompletion } from './src/integrations/inlineCompletion.ts'; export * from 'vscode';`, resolveDir: fileURLToPath(new URL("..", import.meta.url)) }, plugins: [{ name: "fixture", setup(b) {
    b.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "fixture" }))
    b.onResolve({ filter: /runtimeSession\.ts$/ }, () => ({ path: "runtime", namespace: "fixture" }))
    b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "runtime" ? "export function assertTrusted(){}" : `
      const noop={dispose(){}};
      export const control={commands:{},events:{},warnings:[],executed:[],enabled:true,auto:true,visible:false};
      const event=name=>fn=>{control.events[name]=fn;return {dispose(){delete control.events[name]}}};
      export class Position{constructor(line,character){this.line=line;this.character=character}isEqual(p){return p.line===this.line&&p.character===this.character}}
      export class Range{constructor(start,end){this.start=start;this.end=end}}
      export class InlineCompletionItem{constructor(insertText,range){this.insertText=insertText;this.range=range}}
      const position=new Position(0,3);
      const document={uri:{scheme:'file',fsPath:'/workspace/file.ts'},version:1,isClosed:false,languageId:'typescript',offsetAt:p=>p.character,positionAt:n=>new Position(0,n),getText:r=>'con'.slice(r?.start.character??0,r?.end.character)};
      control.editor={document,selection:{isEmpty:true,active:position}};
      export const workspace={isTrusted:true,getConfiguration:()=>({get:key=>key==='completion.enabled'?control.enabled:control.auto}),onDidChangeTextDocument:event('text'),onDidChangeConfiguration:event('config')};
      export const window={get activeTextEditor(){return control.editor},onDidChangeActiveTextEditor:event('editor'),onDidChangeTextEditorSelection:event('selection'),showWarningMessage:m=>control.warnings.push(m),createStatusBarItem:()=>({show(){control.visible=true},hide(){control.visible=false},dispose(){control.visible=false}})};
      export const commands={registerCommand(name,fn){control.commands[name]=fn;return noop},executeCommand:async name=>{control.executed.push(name)}};
      export const languages={registerInlineCompletionItemProvider(selector,p){control.selector=selector;control.provider=p;return noop}};
      export const Disposable={from(...items){return {dispose(){for(const item of items)item.dispose()}}}};
      export const StatusBarAlignment={Right:1};export const InlineCompletionTriggerKind={Invoke:0,Automatic:1};
    ` }))
  } }] })
  const api = await import(pathToFileURL(outfile).href)
  const { control } = api
  const logs: string[] = []
  const requests: { prompt: string; signal: AbortSignal; resolve: (text: string) => void; reject: (error: Error) => void }[] = []
  let phase = "ready", scope = "scope", workspaceChecks = 0, workspaceError = false
  const chat = {
    snapshot: () => ({ phase, sessionTools: { busy: null } }), contextKey: () => scope,
    assertContextWorkspace: async () => { workspaceChecks++; if (workspaceError) throw new Error("wrong workspace") },
    generateText: (prompt: string, signal: AbortSignal) => new Promise<string>((resolve, reject) => { requests.push({ prompt, signal, resolve, reject }) }),
  }
  const registration = api.registerInlineCompletion(chat, (line: string) => logs.push(line))
  t.after(() => registration.dispose())
  function invoke(kind = 0, selectedCompletionInfo?: unknown, abort = new AbortController()) {
    const token = { get isCancellationRequested() { return abort.signal.aborted }, onCancellationRequested(callback: () => void) { abort.signal.addEventListener("abort", callback); return { dispose() { abort.signal.removeEventListener("abort", callback) } } } }
    return control.provider.provideInlineCompletionItems(control.editor.document, control.editor.selection.active, { triggerKind: kind, selectedCompletionInfo }, token)
  }
  return { ...api, requests, invoke, logs, registration, setPhase: (value: string) => { phase = value }, setScope: (value: string) => { scope = value }, setWorkspaceError: () => { workspaceError = true }, checks: () => workspaceChecks }
}

it("manual command avoids the macOS system shortcut and explains unsupported editor states", async t => {
  const f = await fixture(t)
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const binding = manifest.contributes.keybindings.find((item: { command: string }) => item.command === "codem.generateCompletion")
  assert.equal(binding.mac, "cmd+alt+\\")
  assert.notEqual(binding.mac, "cmd+alt+space")
  const command = f.control.commands["codem.generateCompletion"]
  await command(); assert.deepEqual(f.control.executed, ["editor.action.inlineSuggest.trigger"])
  f.control.editor.selection.isEmpty = false; await command(); assert.match(f.control.warnings.pop(), /选区/)
  f.control.editor.selection.isEmpty = true
  f.control.editor.document.uri.scheme = "untitled"; await command(); assert.match(f.control.warnings.pop(), /已保存/)
  f.control.editor.document.uri.scheme = "file"
  f.workspace.isTrusted = false; await command(); assert.match(f.control.warnings.pop(), /信任/)
  f.workspace.isTrusted = true
  f.control.enabled = false; await command(); assert.match(f.control.warnings.pop(), /启用/)
  f.control.enabled = true
  f.setPhase("disconnected"); await command(); assert.match(f.control.warnings.pop(), /连接/)
  assert.equal(f.control.executed.length, 1)
})

it("automatic requests debounce and coalesce; manual requests bypass the delay", async t => {
  const f = await fixture(t)
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const first = f.invoke(1); t.mock.timers.tick(400)
  const second = f.invoke(1); await flush(); assert.deepEqual(await first, [])
  t.mock.timers.tick(599); await flush(); assert.equal(f.requests.length, 0)
  t.mock.timers.tick(1); await flush(); assert.equal(f.requests.length, 1)
  f.requests[0]!.resolve('{"insertText":"sole"}')
  assert.equal((await second)[0].insertText, "sole")
  assert.equal(f.control.visible, false)
  const manual = f.invoke(); await flush(); assert.equal(f.requests.length, 2)
  f.requests[1]!.resolve('{"insertText":"sole"}'); await manual
  assert.equal(f.checks(), 2)
})

it("new input waits for cancelled Core generation to settle, and only the latest request runs", async t => {
  const f = await fixture(t)
  const first = f.invoke(); await flush()
  const second = f.invoke(); const third = f.invoke(); await flush()
  assert.equal(f.requests[0]!.signal.aborted, true)
  assert.equal(f.requests.length, 1)
  f.requests[0]!.resolve('{"insertText":"old"}')
  assert.deepEqual(await first, []); assert.deepEqual(await second, [])
  await flush(); assert.equal(f.requests.length, 2); assert.equal(f.control.visible, true)
  f.requests[1]!.resolve('{"insertText":"new"}'); assert.equal((await third)[0].insertText, "new")
  assert.equal(f.control.visible, false)
})

it("suggest-widget completions extend its selected text using exactly the selected range", async t => {
  const f = await fixture(t)
  const range = new f.Range(new f.Position(0, 0), new f.Position(0, 3))
  const pending = f.invoke(0, { range, text: "console" }); await flush()
  assert.match(f.requests[0]!.prompt, /"prefix":"console"/)
  f.requests[0]!.resolve('{"insertText":".log()"}')
  const [item] = await pending
  assert.equal(item.insertText, "console.log()"); assert.equal(item.range, range)
})

it("automatic off, disconnected, busy, and untrusted paths do not call the model; manual still works when auto is off", async t => {
  const f = await fixture(t)
  f.control.auto = false; assert.deepEqual(await f.invoke(1), [])
  const manual = f.invoke(); await flush(); f.requests[0]!.resolve('{"insertText":"ok"}'); await manual
  f.control.auto = true
  for (const phase of ["disconnected", "sending", "sideQuestion", "configuring"]) { f.setPhase(phase); assert.deepEqual(await f.invoke(1), []) }
  f.setPhase("ready"); f.workspace.isTrusted = false; assert.deepEqual(await f.invoke(), [])
  assert.equal(f.requests.length, 1)
})

it("cancellation, document edits, cursor/editor changes, setting changes and disposal invalidate pending results", async t => {
  const f = await fixture(t)
  for (const invalidate of [
    () => f.control.events.text({ document: f.control.editor.document, contentChanges: [{}] }),
    () => f.control.events.selection({ textEditor: f.control.editor }),
    () => f.control.events.editor(),
    () => f.control.events.config({ affectsConfiguration: () => true }),
    () => f.control.commands["codem.cancelCompletion"](),
  ]) {
    const pending = f.invoke(); await flush(); const request = f.requests.at(-1)!
    invalidate(); assert.equal(request.signal.aborted, true)
    request.resolve('{"insertText":"stale"}'); assert.deepEqual(await pending, [])
  }
  const pending = f.invoke(); await flush()
  f.control.events.text({ document: {}, contentChanges: [{}] })
  assert.equal(f.requests.at(-1)!.signal.aborted, false, "unrelated document changes must not cancel")
  f.registration.dispose(); assert.equal(f.requests.at(-1)!.signal.aborted, true)
  f.requests.at(-1)!.resolve('{"insertText":"stale"}'); assert.deepEqual(await pending, [])
  assert.deepEqual(await f.invoke(), [])
})

it("cancelled debounce and changed session never start a model request", async t => {
  const f = await fixture(t)
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const abort = new AbortController()
  const cancelled = f.invoke(1, undefined, abort); abort.abort(); assert.deepEqual(await cancelled, [])
  const switched = f.invoke(1); f.setScope("new-session"); t.mock.timers.tick(600); assert.deepEqual(await switched, [])
  assert.equal(f.requests.length, 0)
})

it("failures release ownership, report manual errors and log automatic errors without repeated popups", async t => {
  const f = await fixture(t)
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const manual = f.invoke(); await flush(); f.requests[0]!.reject(new Error("model failed"))
  assert.deepEqual(await manual, []); assert.deepEqual(f.control.warnings, ["model failed"])
  const automatic = f.invoke(1); t.mock.timers.tick(600); await flush(); f.requests[1]!.resolve("invalid JSON")
  assert.deepEqual(await automatic, []); assert.equal(f.control.warnings.length, 1)
  assert.ok(f.logs.some((line: string) => line.startsWith("Inline completion failed (automatic)")))
  assert.equal(f.control.visible, false)
  f.setWorkspaceError(); assert.deepEqual(await f.invoke(), []); assert.equal(f.requests.length, 2)
  assert.equal(f.control.warnings.at(-1), "wrong workspace")
})
