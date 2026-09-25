import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { existsSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveAppServerRuntime } from "../src/runtime.ts"
import {
  appServerSpaceLaunch,
  commitAppServerSpace,
  listAppServerSpaces,
  parseAppServerSpaces,
  prepareAppServerSpace,
  prepareInitialAppServerSpace,
} from "../src/spaces.ts"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(mode = "ok") {
  const root = mkdtempSync(join(tmpdir(), "codem-spaces-"))
  roots.push(root)
  const executable = join(root, "broker.cjs")
  const capture = join(root, "calls.jsonl")
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({pid:process.pid})+'\\n');
const send = (id,result) => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
const lines = require('node:readline').createInterface({input:process.stdin});
lines.on('line', line => {
 const f=JSON.parse(line); fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify(f)+'\\n');
 if (!f.id) return;
 if (${JSON.stringify(mode)} === 'hang') return;
 if (${JSON.stringify(mode)} === 'crash') process.exit(3);
 if (${JSON.stringify(mode)} === 'malformed') { process.stdout.write('bad frame\\n'); return; }
 if(f.method==='initialize') return send(f.id,{protocolVersion:'2025-03-26',serverInfo:{name:'codem__host',version:${JSON.stringify(mode === "version" ? "0.0.0" : "0.1.208")}},capabilities:{tools:{}}});
 if (${JSON.stringify(mode)} === 'secret') return process.stdout.write(JSON.stringify({id:f.id,error:{code:-1,message:'secret-fixture-token',data:{token:'secret-fixture-token'}}})+'\\n');
 const name=f.params.name;
 if (${JSON.stringify(mode)} === 'prepareHang' && name === 'space_prepare') return;
 if (${JSON.stringify(mode)} === 'prepareSecret' && name === 'space_prepare') return process.stdout.write(JSON.stringify({id:f.id,error:{code:-1,message:'secret-fixture-token'}})+'\\n');
 const result=name==='project_list' ? {ok:true,current:'proj_a',projects:[{project_key:'proj_a',display_name:'Space A',token:'secret-fixture-token'}]} : name==='space_prepare' ? {ok:true,project_key: ${JSON.stringify(mode === "mismatch" ? "proj_other" : "proj_a")},project_name:'Space A',status:${JSON.stringify(mode === "empty" ? "empty" : "ok")},managed_dir:${JSON.stringify(mode === "empty" ? null : mode === "path" ? "relative/path" : root)}} : {ok:true};
 send(f.id,{content:[{type:'text',text:JSON.stringify(result)}],isError:false});
});
`,
  )
  chmodSync(executable, 0o755)
  const runtime = {
    ...resolveAppServerRuntime({ packageRoot: new URL("..", import.meta.url).pathname }),
    authExecutablePath: executable,
  }
  return { root, capture, options: { runtime, workingDirectory: root, timeoutMs: 3000 } }
}

test("broker projects are projected to a credential-free catalog; prepare never commits", async () => {
  const f = fixture()
  assert.deepEqual(await listAppServerSpaces(f.options), {
    current: "proj_a",
    spaces: [{ projectKey: "proj_a", displayName: "Space A" }],
  })
  const prepared = await prepareAppServerSpace(f.options, "proj_a")
  assert.deepEqual(appServerSpaceLaunch(prepared), {
    arguments: ["--project-key", "proj_a"],
    environment: { CODEM_MANAGED_DIR: f.root },
  })
  const before = readFileSync(f.capture, "utf8")
  assert.ok(!before.includes("space_commit"))
  await commitAppServerSpace(f.options, "proj_a")
  assert.ok(readFileSync(f.capture, "utf8").includes("space_commit"))
})

test("empty managed space explicitly clears inherited enterprise configuration", async () => {
  const f = fixture("empty")
  const prepared = await prepareAppServerSpace(f.options, "proj_a")
  assert.equal(prepared.managedDirectory, null)
  assert.equal(appServerSpaceLaunch(prepared).environment.CODEM_MANAGED_DIR, "")
})

test("malformed catalogs, duplicate IDs and invalid current selection fail closed", () => {
  const entry = { project_key: "proj_a", display_name: "Space A" }
  for (const payload of [
    { projects: [entry, entry], current: "proj_a" },
    { projects: [], current: "proj_a" },
    { projects: [entry] },
    { projects: [{ ...entry, project_key: "../x" }], current: null },
  ])
    assert.throws(() => parseAppServerSpaces(payload))
  assert.deepEqual(parseAppServerSpaces({ projects: [], current: null }), { spaces: [], current: null })
})

test("broker version, malformed output, crash, wrong space and relative managed paths are rejected", async () => {
  for (const mode of ["version", "malformed", "crash", "mismatch", "path"]) {
    const f = fixture(mode)
    await assert.rejects(prepareAppServerSpace(f.options, "proj_a"))
    assert.ok(!readFileSync(f.capture, "utf8").includes("space_commit"))
  }
})

test("credential broker errors are redacted", async () => {
  const f = fixture("secret")
  await assert.rejects(
    listAppServerSpaces(f.options),
    (error: Error) => !String(error).includes("secret-fixture-token"),
  )
})

test("a non-positive broker timeout is rejected before any broker starts", async () => {
  const f = fixture()
  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(listAppServerSpaces({ ...f.options, timeoutMs }), /CodeM space broker timeout must be positive/)
  }
  assert.equal(existsSync(f.capture), false)
})

test("broker timeout and cancellation terminate pending subprocesses, then a retry succeeds", async () => {
  const f = fixture("hang")
  await assert.rejects(listAppServerSpaces({ ...f.options, timeoutMs: 100 }), /timed out/)
  const controller = new AbortController()
  const pending = listAppServerSpaces({ ...f.options, signal: controller.signal })
  setTimeout(() => controller.abort(), 50)
  await assert.rejects(pending, /cancelled/)
  const healthy = fixture()
  assert.equal((await listAppServerSpaces(healthy.options)).current, "proj_a")
})


test("startup gate: catalog and preparation share one broker and initialization", async () => {
  const f = fixture()
  const result = await prepareInitialAppServerSpace(f.options)
  assert.equal(result.kind, "prepared")
  if (result.kind !== "prepared") throw new Error("Expected prepared space")
  assert.equal(result.space.projectKey, "proj_a")
  const frames = readFileSync(f.capture, "utf8").trim().split("\n").map(line => JSON.parse(line))
  assert.equal(frames.filter(frame => frame.pid).length, 1)
  assert.equal(frames.filter(frame => frame.method === "initialize").length, 1)
  assert.deepEqual(frames.filter(frame => frame.method === "tools/call").map(frame => frame.params.name), ["project_list", "space_prepare"])
  assert.throws(() => process.kill(frames[0].pid, 0), { code: "ESRCH" }, "The broker must exit before returning launch material")
  assert.ok(!JSON.stringify(result).includes("secret-fixture-token"))
})

test("startup gate: unavailable remembered space returns a catalog without preparing or keeping a broker alive", async () => {
  const f = fixture()
  const result = await prepareInitialAppServerSpace(f.options, "proj_missing")
  assert.equal(result.kind, "selection-required")
  assert.equal(result.catalog.spaces[0]?.projectKey, "proj_a")
  const frames = readFileSync(f.capture, "utf8").trim().split("\n").map(line => JSON.parse(line))
  assert.deepEqual(frames.filter(frame => frame.method === "tools/call").map(frame => frame.params.name), ["project_list"])
  assert.throws(() => process.kill(frames[0].pid, 0), { code: "ESRCH" })
})

test("startup gate: failure in the second broker call is redacted and preparation can be retried", async () => {
  for (const mode of ["prepareSecret", "mismatch", "path"]) {
    const f = fixture(mode)
    await assert.rejects(prepareInitialAppServerSpace(f.options), (error: Error) => !String(error).includes("secret-fixture-token"))
    const frames = readFileSync(f.capture, "utf8").trim().split("\n").map(line => JSON.parse(line))
    assert.throws(() => process.kill(frames[0].pid, 0), { code: "ESRCH" })
  }
  const healthy = fixture()
  assert.equal((await prepareInitialAppServerSpace(healthy.options, "proj_a")).kind, "prepared")
})

test("startup gate: cancellation and deadline cover the second broker call and reap its process", async () => {
  for (const cancel of [false, true]) {
    const f = fixture("prepareHang")
    const abort = new AbortController()
    const pending = prepareInitialAppServerSpace({ ...f.options, timeoutMs: cancel ? 5000 : 1000, signal: abort.signal })
    const failure = assert.rejects(pending, cancel ? /cancelled/ : /timed out/)
    try {
      if (cancel) {
        const deadline = performance.now() + 4000
        while (!existsSync(f.capture) || !readFileSync(f.capture, "utf8").includes('"name":"space_prepare"')) {
          if (performance.now() >= deadline) throw new Error("Fixture did not reach the second call")
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        abort.abort()
      }
      await failure
      const frames = readFileSync(f.capture, "utf8").trim().split("\n").map(line => JSON.parse(line))
      assert.ok(frames.some(frame => frame.params?.name === "space_prepare"))
      assert.throws(() => process.kill(frames[0].pid, 0), { code: "ESRCH" })
    } finally { abort.abort(); await failure }
  }
})
