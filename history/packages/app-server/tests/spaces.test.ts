import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveAppServerRuntime } from "../src/runtime.ts"
import {
  appServerSpaceLaunch,
  commitAppServerSpace,
  listAppServerSpaces,
  parseAppServerSpaces,
  prepareAppServerSpace,
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
