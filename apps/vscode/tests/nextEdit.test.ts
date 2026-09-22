import assert from "node:assert/strict"
import { it, type TestContext } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("..", import.meta.url))
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "codem-next-edit-")); t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: { contents: `export { NextEdit } from './src/integrations/nextEdit/nextEdit.ts'; export * from './tests/fixtures/nextEditVscode.ts';`, resolveDir: root }, plugins: [{ name: "vscode", setup(b) { b.onResolve({ filter: /^vscode$/ }, () => ({ path: join(root, "tests/fixtures/nextEditVscode.ts") })) } }] })
  const api = await import(pathToFileURL(outfile).href)
  let key = "session:model", ready = true, calls = 0
  const logs: string[] = []
  let generate = async (_prompt: string, _signal: AbortSignal) => JSON.stringify({ edit: { line: 2, before: "console.log(old);", after: "console.log(label);", reason: "同步引用" } })
  let check = async () => {}
  const feature = new api.NextEdit({ contextKey: () => key, completionContext: () => ({ key, ready }), assertContextWorkspace: () => check(), generateText: (prompt: string, signal: AbortSignal) => { calls++; return generate(prompt, signal) } }, (line: string) => logs.push(line))
  t.after(() => feature.dispose())
  return { ...api, feature, logs, count: () => calls, generate: (fn: typeof generate) => { generate = fn }, check: (fn: typeof check) => { check = fn }, context: (next: string) => { key = next; feature.contextChanged() }, ready: (next: boolean) => { ready = next; feature.contextChanged() }, run: (name: string, ...args: unknown[]) => api.control.commands['codem.' + name](...args) }
}
it("predicts without writing, jumps separately, accepts one undoable edit and rejects stale command IDs", async t => {
  const f = await fixture(t)
  assert.equal(f.control.contexts['codem.nextEditVisible'], false)
  await f.run('predictNextEdit')
  assert.equal(f.count(), 1); assert.equal(f.control.writes, 0)
  const id = f.control.lens.provideCodeLenses(f.document)[0].command.arguments[0]
  await f.run('jumpNextEdit', id)
  assert.equal(f.editor.selection.active.line, 1); assert.equal(f.control.writes, 0)
  assert.equal(f.control.contexts['codem.nextEditAtTarget'], true)
  f.control.apply = false; await f.run('acceptNextEdit', id)
  assert.equal(f.control.contexts['codem.nextEditVisible'], true)
  f.control.apply = true; await f.run('acceptNextEdit', id)
  assert.equal(f.control.text, 'const label = 1;\nconsole.log(label);\n')
  assert.equal(f.control.undo[0], 'const label = 1;\nconsole.log(old);\n')
  assert.equal(f.control.contexts['codem.nextEditVisible'], false)
  await f.run('acceptNextEdit', id); assert.equal(f.control.writes, 1)
})
it("cancels, serializes replacements until old generation settles, and ignores late responses", async t => {
  const f = await fixture(t)
  let resolve!: (text: string) => void, signal!: AbortSignal
  f.generate(async (_prompt: string, abort: AbortSignal) => { signal = abort; return new Promise(done => { resolve = done }) })
  const first = f.run('predictNextEdit'); await new Promise(done => setImmediate(done))
  const second = f.run('predictNextEdit'); await new Promise(done => setImmediate(done))
  assert.equal(signal.aborted, true); assert.equal(f.count(), 1)
  await f.run('dismissNextEdit'); resolve('{"edit":null}'); await Promise.all([first, second])
  assert.equal(f.count(), 1); assert.equal(f.control.contexts['codem.nextEditVisible'], false)
})
it("invalidates on text, editor, model and workspace changes and guards acceptance after async check", async t => {
  const f = await fixture(t)
  await f.run('predictNextEdit'); f.context('other'); assert.equal(f.control.contexts['codem.nextEditVisible'], false)
  await f.run('predictNextEdit'); f.document.version++; f.control.changed.fire({ document: f.document, contentChanges: [{rangeOffset:0,rangeLength:0,text:'',range:new f.Range(new f.Position(0,0),new f.Position(0,0))}] })
  assert.equal(f.control.contexts['codem.nextEditVisible'], false)
  await f.run('predictNextEdit'); f.control.switched.fire(undefined); assert.equal(f.control.contexts['codem.nextEditVisible'], false)
  await f.run('predictNextEdit'); f.control.folders.fire({}); assert.equal(f.control.contexts['codem.nextEditVisible'], false)
  await f.run('predictNextEdit'); f.check(async () => { f.document.version++ })
  await f.run('acceptNextEdit'); assert.equal(f.control.writes, 0)
  f.check(async () => {})
  await f.run('predictNextEdit'); f.document.isClosed = true; f.control.closed.fire(f.document)
  assert.equal(f.control.contexts['codem.nextEditVisible'], false)
})
it("handles empty and malformed results, busy and untrusted contexts, and failure retry", async t => {
  const f = await fixture(t)
  f.ready(false); await f.run('predictNextEdit'); assert.equal(f.count(), 0)
  f.ready(true); f.control.trusted = false; await f.run('predictNextEdit'); assert.equal(f.count(), 0)
  f.control.trusted = true
  f.generate(async () => 'malformed'); await f.run('predictNextEdit'); assert.equal(f.control.contexts['codem.nextEditVisible'], false)
  f.generate(async () => '{"edit":null}'); await f.run('predictNextEdit'); assert.match(f.control.messages.at(-1), /没有明确/)
  assert.equal(f.count(), 2); assert.equal(f.control.writes, 0)
})
it("includes bounded recent-edit intent and discards in-flight results after a document edit", async t => {
  const f = await fixture(t)
  const range = new f.Range(new f.Position(0,6),new f.Position(0,11))
  f.control.text = f.control.text.replace('label','renamed'); f.document.version++
  f.control.changed.fire({ document:f.document, contentChanges:[{ range,rangeOffset:6,rangeLength:5,text:'renamed' }] })
  let resolve!: (text:string)=>void
  f.generate(async (prompt: string) => { assert.match(prompt, /"before":"label","after":"renamed"/); return new Promise(done=>{ resolve=done }) })
  const pending=f.run('predictNextEdit'); await new Promise(done=>setImmediate(done))
  f.document.version++; f.control.changed.fire({ document:f.document,contentChanges:[{range,rangeOffset:6,rangeLength:7,text:'another'}] })
  resolve(JSON.stringify({edit:{line:2,before:'console.log(old);',after:'console.log(renamed);',reason:'rename'}})); await pending
  assert.equal(f.control.contexts['codem.nextEditVisible'],false); assert.equal(f.control.writes,0)
})
it("binds Tab only for visible Next Edit, without hijacking inline suggestions or snippets", async () => {
  const manifest = JSON.parse(await readFile(join(root,'package.json'),'utf8'))
  const bindings=manifest.contributes.keybindings.filter((row:{command:string})=>row.command.includes('NextEdit'))
  assert.equal(bindings.length,4)
  for(const binding of bindings.filter((row:{key:string})=>row.key==='tab')) for(const condition of ['codem.nextEditVisible','!suggestWidgetVisible','!inlineSuggestionVisible','!inSnippetMode','!editorTabMovesFocus','!editorReadonly']) assert.ok(binding.when.includes(condition))
})
it("cancels generation on cursor movement and disposal without reviving controls", async t => {
  const f = await fixture(t)
  let abort!: AbortSignal, resolve!: (text: string) => void
  f.generate(async (_prompt: string, signal: AbortSignal) => { abort = signal; return new Promise(done => { resolve = done }) })
  const pending = f.run('predictNextEdit'); await new Promise(done => setImmediate(done))
  f.editor.selection = new f.Selection(new f.Position(1,0), new f.Position(1,0))
  assert.equal(abort.aborted, true)
  f.feature.dispose(); resolve('{"edit":null}'); await pending
  assert.equal(f.control.contexts['codem.nextEditVisible'], false); assert.equal(f.control.contexts['codem.nextEditBusy'], false)
})
it("times out with an actionable message and releases the request only after cancellation settles", async t => {
  const f = await fixture(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  f.generate(async (_prompt: string, signal: AbortSignal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('cancelled')), { once:true }) }))
  const pending = f.run('predictNextEdit'); await new Promise(done => setImmediate(done))
  t.mock.timers.tick(15000); await pending
  assert.match(f.control.messages.at(-1), /15 秒/)
  assert.equal(f.control.contexts['codem.nextEditBusy'], false)
})
it("keeps CodeLens stable across unrelated chat snapshots and gates Tab while busy", async t => {
  const f = await fixture(t)
  await f.run('predictNextEdit')
  let refreshes = 0
  f.control.lens.onDidChangeCodeLenses(() => { refreshes++ })
  f.feature.contextChanged(); f.feature.contextChanged()
  assert.equal(refreshes, 0)
  f.ready(false); assert.equal(f.control.contexts['codem.nextEditVisible'], false)
  f.ready(true); assert.equal(f.control.contexts['codem.nextEditVisible'], true)
  assert.equal(refreshes, 2)
})
