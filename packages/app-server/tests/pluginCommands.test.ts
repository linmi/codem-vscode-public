import assert from "node:assert/strict"
import { it } from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createPluginCommands, parseInstalledPlugins, PluginOperationError } from "../src/plugins/pluginCommands.ts"
import type { AppServerRuntime } from "../src/runtime.ts"

it("strictly parses installed plugins without confusing missing enabled state with false", () => {
  const row = { name: "sample", enabled: false, version: "1.0.0", path: "/plugins/sample" }
  assert.deepEqual(parseInstalledPlugins({ "sample@local": row }), [{ key: "sample@local", ...row }])
  for (const value of [[], null, { sample: { ...row, enabled: undefined } }, { sample: { ...row, path: "relative" } }, { "--bad": row }, { sample: { ...row, version: "/secret" } }]) assert.throws(() => parseInstalledPlugins(value))
})

it("uses bounded argument-array commands, validates local installs, rejects duplicates and stale handles", async t => {
  const root = await mkdtemp(join(tmpdir(), "codem-plugin-command-")); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, "space and $literal"); await mkdir(join(source, ".codem-plugin"), { recursive: true })
  await writeFile(join(source, ".codem-plugin/plugin.json"), JSON.stringify({ name: "sample", version: "1.0.0" }))
  await writeFile(join(root, "registry.json"), "{}")
  await writeFile(join(root, "plugin"), `const fs=require('node:fs'); const args=process.argv.slice(2);fs.appendFileSync('calls.jsonl',JSON.stringify(args)+'\\n');let registry=JSON.parse(fs.readFileSync('registry.json','utf8')); if(args[0]==='list')console.log(JSON.stringify(registry)); else if(args[0]==='install'){registry.sample={name:'sample',enabled:true,version:'1.0.0',path:args[1]};fs.writeFileSync('registry.json',JSON.stringify(registry))} else if(args[0]==='disable'||args[0]==='enable'){registry[args[1]].enabled=args[0]==='enable';fs.writeFileSync('registry.json',JSON.stringify(registry))}else if(args[0]==='uninstall'){delete registry[args[1]];fs.writeFileSync('registry.json',JSON.stringify(registry))}`)
  const timings: string[] = []
  const commands = createPluginCommands({ runtime: { executablePath: process.execPath } as AppServerRuntime, cwd: root, observe: op => timings.push(op) })
  const signal = new AbortController().signal
  assert.equal(await commands.install({ kind: "local", path: source }, signal), "sample")
  let entries = await commands.list(signal)
  assert.equal(entries[0]!.enabled, true)
  await assert.rejects(commands.install({ kind: "local", path: source }, signal), error => error instanceof PluginOperationError && error.code === "alreadyInstalled")
  const before = entries[0]!
  await commands.change("disable", before, signal)
  await assert.rejects(commands.change("uninstall", before, signal), /changed/)
  entries = await commands.list(signal); assert.equal(entries[0]!.enabled, false)
  await commands.change("enable", entries[0]!, signal)
  entries = await commands.list(signal)
  await commands.change("uninstall", entries[0]!, signal)
  assert.deepEqual(await commands.list(signal), [])
  await assert.rejects(commands.install({ kind: "marketplace", spec: "--help" }, signal), /marketplace/)
  await assert.rejects(commands.install({ kind: "local", path: "relative" }, signal), /absolute/)
  await writeFile(join(source, ".codem-plugin/plugin.json"), " ".repeat(64_001))
  await assert.rejects(commands.install({ kind: "local", path: source }, signal), /64 KB/)
  const calls = (await readFile(join(root, "calls.jsonl"), "utf8")).trim().split('\n').map(line => JSON.parse(line) as string[])
  assert.deepEqual(calls.filter(args => args[0] === "install"), [["install", await realpath(source)]])
  assert.equal(timings.filter(op => op === "plugin/install").length, 1)
})

it("rejects a timeout that would expire every command at once", () => {
  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => createPluginCommands({ runtime: { executablePath: process.execPath } as AppServerRuntime, cwd: tmpdir(), timeoutMs }), /CodeM plugin command timeout must be positive/)
  }
})

for (const mode of ["cancel", "timeout", "overflow", "failure"] as const) {
  it(`reaps plugin subprocess after ${mode} without exposing stderr`, async t => {
    const root = await mkdtemp(join(tmpdir(), "codem-plugin-process-")); t.after(() => rm(root, { recursive: true, force: true }))
    await writeFile(join(root, "plugin"), `const fs=require('node:fs');fs.writeFileSync('pid',String(process.pid));process.on('SIGTERM',()=>{});${mode === "failure" ? "console.error('/private/secret-token');process.exit(2)" : mode === "overflow" ? "process.stdout.write('x'.repeat(1100000));setInterval(()=>{},1000)" : "setInterval(()=>{},1000)"}`)
    const commands = createPluginCommands({ runtime: { executablePath: process.execPath } as AppServerRuntime, cwd: root, timeoutMs: mode === "timeout" ? 100 : 5000 })
    const abort = new AbortController()
    const pending = commands.list(abort.signal)
    if (mode === "cancel") setTimeout(() => abort.abort(), 100)
    await assert.rejects(pending, error => { assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /secret-token/); return true })
    const pid = Number(await readFile(join(root, "pid"), "utf8"))
    assert.throws(() => process.kill(pid, 0), /ESRCH/)
  })
}

it("cancellation reaps a task-owned helper process as well as the plugin command", { skip: process.platform === "win32" }, async t => {
  const root = await mkdtemp(join(tmpdir(), "codem-plugin-tree-")); t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, "plugin"), `const {spawn}=require('node:child_process');const fs=require('node:fs');const helper=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});fs.writeFileSync('helper',String(helper.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`)
  const commands = createPluginCommands({ runtime: { executablePath: process.execPath } as AppServerRuntime, cwd: root, timeoutMs: 200 })
  await assert.rejects(commands.list(new AbortController().signal), /timed out/)
  const pid = Number(await readFile(join(root, "helper"), "utf8"))
  // Kernel reparenting/reaping may trail the parent's close notification briefly.
  for (let attempt = 0; attempt < 20; attempt++) {
    try { process.kill(pid, 0) } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "ESRCH"); return }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail("Plugin helper survived process group cleanup")
})
