/** Opt-in real Core pagination over a temporary schema-13 fixture; no model calls. */
import assert from "node:assert/strict"
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { AppServerHost, DEFAULT_APP_SERVER_THREAD_SETTINGS, resolveAppServerRuntime } from "@codem/app-server"
import { projectHashForCwd } from "../../../packages/history/src/shared/cli-adapter/records/cwd.ts"
import { LiveSnapshotCatalog } from "../src/chat/liveSnapshotCatalog.ts"
import type { LiveCatalogView } from "../src/shared/capabilityTypes.ts"

const cwd = await realpath(await mkdtemp(join(tmpdir(), "codem-live-pagination-")))
const sessionsRoot = join(cwd, "sessions"), threadId = "pagination-fixture", at = "2026-09-20T00:00:00Z"
const runtime = resolveAppServerRuntime({ packageRoot: fileURLToPath(new URL("../../../packages/app-server", import.meta.url)) })
const host = new AppServerHost({ runtime, environment: { ...process.env, LINCO_SESSIONS_ROOT: sessionsRoot }, clientInfo: { name: "codem-pagination-check", version: "1" }, assertAuthenticated() {} })
const failures: unknown[] = []
let view: LiveCatalogView | null = null
const current = (): LiveCatalogView => { assert.ok(view); return view }
host.onEvent(event => { if (event.type === "protocol-error") failures.push(event.message) })
const catalog = new LiveSnapshotCatalog(next => { view = next }, () => {}, (_operation, error) => failures.push(error))
const counts = { authorize: 0, loaded: 0, turns: 0, items: 0 }
const context = {
  cwd, threadId,
  authorize: async () => { counts.authorize++ },
  host: {
    listLoadedThreadIds: async (cwd: string) => { counts.loaded++; return host.listLoadedThreadIds(cwd) },
    listLiveThreadTurns: async (cwd: string, thread: string, cursor?: number) => { counts.turns++; return host.listLiveThreadTurns(cwd, thread, cursor) },
    listLiveThreadItems: async (cwd: string, thread: string, cursor?: number) => { counts.items++; return host.listLiveThreadItems(cwd, thread, cursor) },
  },
}
try {
  const directory = join(sessionsRoot, projectHashForCwd(cwd)); await mkdir(directory, { recursive: true })
  const records: object[] = [{ type: "header", schema_version: 13, session_id: threadId, cwd, started_at: at, model: "codem-router/auto", provider: "openai_compat" }]
  for (let i = 0; i < 105; i++) records.push(
    { type: "user_invocation", at, submission_id: `s${i}`, input: { kind: "message", content: `Question ${i}` } },
    { type: "turn_request", at, turn_index: i, model: "codem-router/auto" },
    { type: "assistant_text", at, text: `Answer ${i}` },
    { type: "turn_end", at, turn_index: i, stop_reason: "EndTurn" },
  )
  await writeFile(join(directory, `${threadId}.jsonl`), records.map((record, i) => JSON.stringify({ ...record, record_seq: i + 1 })).join("\n") + "\n")
  await host.resumeThread(cwd, threadId, DEFAULT_APP_SERVER_THREAD_SETTINGS)
  const started = performance.now()
  await catalog.refresh(context)
  const refreshMs = performance.now() - started
  assert.deepEqual(failures, [])
  assert.equal(current().pages!.turns.rows.length, 50)
  assert.equal(current().pages!.items.rows.length, 50)
  const pageMs: number[] = []
  for (const kind of ["turns", "items"] as const) {
    for (let page = 0; current().pages![kind].hasMore; page++) {
      assert.ok(page < 10, "Pagination must terminate")
      const before = current().pages![kind].rows.length, started = performance.now()
      await catalog.more(current().snapshotId, kind)
      pageMs.push(performance.now() - started)
      assert.deepEqual(failures, [])
      assert.ok(current().pages![kind].rows.length > before)
    }
  }
  assert.equal(current().pages!.turns.rows.length, 105)
  assert.equal(current().pages!.items.rows.length, 210)
  assert.equal(current().pages!.turns.total, 105)
  assert.equal(current().pages!.items.total, 210)
  assert.deepEqual(counts, { authorize: 7, loaded: 1, turns: 3, items: 5 })
  console.log(`LIVE_SNAPSHOT_CORE_OK ${JSON.stringify({ core: runtime.coreVersion, counts, refreshMs: +refreshMs.toFixed(2), pageMs: pageMs.map(ms => +ms.toFixed(2)) })}`)
} finally {
  catalog.clear()
  await host.close()
  await rm(cwd, { recursive: true, force: true })
}
