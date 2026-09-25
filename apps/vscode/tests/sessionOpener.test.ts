import assert from "node:assert/strict"
import { it, type TestContext } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

async function load(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "codem-session-opener-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "fixture.mjs")
  await build({ outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", stdin: {
    contents: `export { SessionOpener } from './apps/vscode/src/connection/sessionOpener.ts'; export { control } from 'runtime';`, resolveDir: fileURLToPath(new URL("../../..", import.meta.url)),
  }, plugins: [{ name: "runtimeFixture", setup(b) {
    b.onResolve({ filter: /(^runtime$|runtimeSession\.ts$)/ }, () => ({ path: "runtime", namespace: "fixture" }))
    // Only the Core connection is replaced; it reports an auth status, then yields a session with an observable Host.
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
      export const control = {connections:[],closed:0,listeners:[],beforeAuth:async()=>{}};
      export async function connectRuntime(runtime,version,signal,target,directory,onAuth){
        control.connections.push({runtime,version,target,directory});
        await control.beforeAuth(); onAuth({loggedIn:true,routerCredential:true});
        return {cwd:'/workspace',workspace:'workspace',space:{key:'space-1',name:'Space'},spaceDirectory:{id:'directory'},mcpServers:[],host:{onEvent(fn){control.listeners.push(fn);return()=>{}},async close(){control.closed++}}};
      }
    ` }))
  } }] })
  return import(pathToFileURL(outfile).href)
}

/** The activation's runtime verifier; each connection must reuse this one instance. */
const resolveRuntime = async () => ({ executable: "/extension/codem" })

function options(overrides: Record<string, unknown> = {}) {
  const lines: string[] = []
  const auth: unknown[] = []
  const remembered: unknown[] = []
  return {
    lines, auth, remembered,
    value: {
      runtime: resolveRuntime, version: "1.2.3",
      preferences: { lastConnection: () => ({ cwd: "/workspace", workspace: "workspace", key: "space-0" }), remember: async (target: unknown) => { remembered.push(target) } },
      loadMcp: async () => [{ type: "stdio", name: "tools", command: "node", args: [], env: [] }],
      observeAuth: (status: unknown) => { auth.push(status) },
      log: (line: string) => { lines.push(line) },
      ...overrides,
    },
  }
}

it("connects to the last workspace and space, loads MCP settings and logs only turn identities", async t => {
  const { SessionOpener, control } = await load(t)
  const f = options()
  const session = await new SessionOpener(f.value).connect(new AbortController().signal)
  assert.deepEqual(control.connections, [{ runtime: resolveRuntime, version: "1.2.3", target: { cwd: "/workspace", workspace: "workspace", key: "space-0" }, directory: undefined }])
  assert.deepEqual(session.mcpServers.map((server: { name: string }) => server.name), ["tools"])
  assert.equal(f.auth.length, 1)
  assert.match(f.lines[0]!, /^Connection runtime: \d+ms$/)
  assert.match(f.lines[1]!, /^Connection MCP settings: \d+ms$/)
  for (const listener of control.listeners) {
    listener({ type: "turn-started", turnId: "turn-1", submissionId: "submission-1", text: "private prompt" })
    listener({ type: "item-delta", turnId: "turn-1", text: "private reply" })
    listener({ type: "turn-completed", turnId: "turn-1", outcome: "completed", stopReason: "end_turn", text: "private reply" })
  }
  assert.deepEqual(f.lines.slice(2), [
    JSON.stringify({ event: "turn-started", turnId: "turn-1", submissionId: "submission-1" }),
    JSON.stringify({ event: "turn-completed", turnId: "turn-1", outcome: "completed", stopReason: "end_turn" }),
  ])
  await new SessionOpener(f.value).remember(session)
  assert.deepEqual(f.remembered, [{ cwd: "/workspace", workspace: "workspace", key: "space-1" }])
})

it("closes a session whose MCP settings fail to load and reports nothing after cancellation", async t => {
  const { SessionOpener, control } = await load(t)
  const failing = options({ loadMcp: async () => { throw new Error("SecretStorage unavailable") } })
  await assert.rejects(new SessionOpener(failing.value).connect(new AbortController().signal), /SecretStorage unavailable/)
  assert.equal(control.closed, 1, "The runtime connection is closed before the failure propagates")
  assert.equal(control.listeners.length, 0)
  assert.deepEqual(failing.lines.map(line => line.replace(/\d+ms/, "Nms")), ["Connection runtime: Nms"])
  const cancelled = options()
  const abort = new AbortController()
  control.beforeAuth = async () => { abort.abort() }
  await new SessionOpener(cancelled.value).connect(abort.signal)
  assert.deepEqual(cancelled.auth, [], "An auth status read after cancellation is not reported")
  const invalid = options({ preferences: { lastConnection: () => { throw new Error("Invalid saved CodeM connection") }, remember: async () => {} } })
  const before = control.connections.length
  await assert.rejects(new SessionOpener(invalid.value).connect(new AbortController().signal), /Invalid saved CodeM connection/)
  assert.equal(control.connections.length, before, "A corrupt saved connection fails before Core is started")
})

it("reopens the same workspace in another space with the directory already read, without a second turn log", async t => {
  const { SessionOpener, control } = await load(t)
  const f = options()
  const opener = new SessionOpener(f.value)
  const session = await opener.connect(new AbortController().signal)
  await opener.reopen(session, "space-2", new AbortController().signal)
  assert.deepEqual(control.connections[1], { runtime: resolveRuntime, version: "1.2.3", target: { cwd: "/workspace", workspace: "workspace", key: "space-2" }, directory: { id: "directory" } })
  assert.equal(control.listeners.length, 1, "Only the chat's own connection logs turns")
})
