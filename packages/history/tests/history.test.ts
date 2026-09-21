import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { mkdtemp, mkdir, writeFile, appendFile, rm, symlink, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readSessionHistory, resolveSessionsRoot } from "../src/index.ts"
import { projectHashForCwd } from "../src/shared/cli-adapter/records/cwd.ts"
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const at = "2026-09-16T00:00:00Z"
async function fixture() {
  const sessionsRoot = await mkdtemp(join(tmpdir(), "codem-history-"))
  roots.push(sessionsRoot)
  const cwd = "/workspace",
    threadId = "thread-1"
  const directory = join(sessionsRoot, projectHashForCwd(cwd))
  await mkdir(directory)
  const path = join(directory, `${threadId}.jsonl`)
  const records: Record<string, unknown>[] = [
    {
      type: "header",
      schema_version: 13,
      session_id: threadId,
      cwd,
      started_at: at,
      model: "codem-router/auto",
      provider: "openai_compat",
    },
  ]
  for (let i = 0; i < 3; i++)
    records.push(
      { type: "user_invocation", at, submission_id: `s${i}`, input: { kind: "message", content: `question ${i}` } },
      { type: "turn_request", at, turn_index: i, model: "codem-router/auto" },
      { type: "user_message", at, origin: "synthetic", content: "hidden reminder" },
      { type: "assistant_text", at, text: i === 0 ? "FIRST LINE\n\nLAST LINE" : `answer ${i}` },
      {
        type: "tool_call",
        at,
        id: `call-${i}`,
        name: "final_answer",
        input: { kind: "chat", status: "complete", summary: `summary ${i}` },
      },
      { type: "tool_result", at, id: `call-${i}`, status: "completed", content: "accepted" },
      { type: "turn_end", at, turn_index: i, stop_reason: "EndTurn" },
    )
  const save = () =>
    writeFile(path, records.map((r, i) => JSON.stringify({ ...r, record_seq: i + 1 })).join("\n") + "\n")
  await save()
  return { options: { sessionsRoot, cwd, threadId }, path, records, save }
}
it("reopens three rounds in order, hides synthetic prompts and pairs tool inputs/results", async () => {
  const f = await fixture()
  const first = await readSessionHistory(f.options)
  assert.deepEqual(
    first.turns.map((x) => x.submissionId),
    ["s0", "s1", "s2"],
  )
  assert.deepEqual(
    first.turns.map((x) =>
      x.turn.items
        .filter((i) => i.kind === "message" && i.role === "user")
        .map((i) => (i.kind === "message" ? i.text : "")),
    ),
    [["question 0"], ["question 1"], ["question 2"]],
  )
  const texts = first.turns[0]!.turn.items.filter((i) => i.kind === "message" && i.role === "assistant").map((i) =>
    i.kind === "message" ? i.text : "",
  )
  assert.deepEqual(texts, ["FIRST LINE\n\nLAST LINE", "summary 0"])
  for (const [n, { turn }] of first.turns.entries()) {
    const tool = turn.items.find((i) => i.kind === "tool-execution")
    assert.ok(tool?.kind === "tool-execution")
    assert.deepEqual(tool.input.value, { kind: "chat", status: "complete", summary: `summary ${n}` })
    assert.equal(tool.result?.value, "accepted")
  }
  assert.deepEqual(await readSessionHistory(f.options), first)
})
it("pages by a stable snapshot and rejects cursors after append or replacement", async () => {
  const f = await fixture()
  const last = await readSessionHistory({ ...f.options, limit: 2 })
  assert.deepEqual(
    last.turns.map((x) => x.submissionId),
    ["s1", "s2"],
  )
  assert.ok(last.nextCursor)
  const first = await readSessionHistory({ ...f.options, limit: 2, cursor: last.nextCursor })
  assert.deepEqual(
    first.turns.map((x) => x.submissionId),
    ["s0"],
  )
  assert.equal(first.nextCursor, null)
  await appendFile(f.path, '{"type":')
  await assert.rejects(readSessionHistory({ ...f.options, cursor: last.nextCursor }), /cursor/u)
  assert.equal((await readSessionHistory(f.options)).turns.length, 3)
})
it("clear and conversation rewind truncation remove old turns; code rewind preserves them", async () => {
  const f = await fixture()
  f.records.push({ type: "rewind_mark", at, checkpoint_id: "checkpoint", mode: "code" })
  await f.save()
  assert.equal((await readSessionHistory(f.options)).turns.length, 3)
  f.records.splice(8)
  await f.save()
  assert.equal((await readSessionHistory(f.options)).turns.length, 1)
  f.records.push({ type: "cleared" })
  await f.save()
  assert.equal((await readSessionHistory(f.options)).turns.length, 0)
})
for (const [label, mutate, pattern] of [
  [
    "version",
    (r: Record<string, unknown>[]) => {
      r[0]!.schema_version = 99
    },
    /schema_version/u,
  ],
  [
    "identity",
    (r: Record<string, unknown>[]) => {
      r[0]!.session_id = "other"
    },
    /does not match/u,
  ],
  [
    "cwd",
    (r: Record<string, unknown>[]) => {
      r[0]!.cwd = "/other"
    },
    /cwd/u,
  ],
  [
    "orphan result",
    (r: Record<string, unknown>[]) => {
      r.find((x) => x.type === "tool_result")!.id = "other"
    },
    /tool/u,
  ],
] as const)
  it(`rejects invalid ${label}`, async () => {
    const f = await fixture()
    mutate(f.records)
    await f.save()
    await assert.rejects(readSessionHistory(f.options), pattern)
  })
it("rejects corruption and duplicate sequence, tolerates only the uncommitted last fragment", async () => {
  const f = await fixture()
  await appendFile(f.path, '{"type":')
  assert.equal((await readSessionHistory(f.options)).turns.length, 3)
  await appendFile(f.path, "\n")
  await assert.rejects(readSessionHistory(f.options), /malformed JSON/u)
  await f.save()
  await appendFile(f.path, JSON.stringify({ type: "cleared", record_seq: 1 }) + "\n")
  await assert.rejects(readSessionHistory(f.options), /record_seq/u)
})
it("rejects traversal, symlinks, invalid limits and aborted reads", async () => {
  const f = await fixture()
  await assert.rejects(readSessionHistory({ ...f.options, threadId: "../other" }), /session id/u)
  await assert.rejects(readSessionHistory({ ...f.options, limit: 0 }), /limit/u)
  await assert.rejects(readSessionHistory({ ...f.options, signal: AbortSignal.abort() }), /abort/iu)
  await rename(f.path, f.path + ".original")
  await symlink(f.path + ".original", f.path)
  await assert.rejects(readSessionHistory(f.options), /symbolic/u)
})
it("uses the same session root precedence as pinned Core", () => {
  assert.equal(resolveSessionsRoot({}, "/home/test"), "/home/test/.codem/sessions")
  assert.equal(resolveSessionsRoot({ LINCO_HOME: "/profile", CODEM_HOME: "/ignored" }), "/profile/sessions")
  assert.equal(resolveSessionsRoot({ LINCO_HOME: "/profile", LINCO_SESSIONS_ROOT: "/shared" }), "/shared")
  assert.throws(() => resolveSessionsRoot({ LINCO_SESSIONS_ROOT: "../relative" }), /absolute/u)
})
it("restores verified durable tool blobs and rejects missing/tampered content", async () => {
  const { createHash } = await import("node:crypto")
  const f = await fixture()
  const body = "complete tool result\n".repeat(1000)
  const result = f.records.find((r) => r.type === "tool_result")!
  result.content = "preview"
  result.external_content = {
    path: "blobs/call-0.txt",
    byte_size: Buffer.byteLength(body),
    content_hash: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    encoding: "utf-8",
    truncated_inline_bytes: 7,
  }
  const dir = join(f.options.sessionsRoot, projectHashForCwd(f.options.cwd), f.options.threadId, "blobs")
  await mkdir(dir, { recursive: true })
  const blob = join(dir, "call-0.txt")
  await writeFile(blob, body)
  await f.save()
  const page = await readSessionHistory(f.options)
  const tool = page.turns[0]!.turn.items.find((i) => i.kind === "tool-execution")
  assert.ok(tool?.kind === "tool-execution")
  assert.equal(tool.result?.value, body)
  await writeFile(blob, "corrupt")
  await assert.rejects(readSessionHistory(f.options), /integrity/u)
  await rm(blob)
  await assert.rejects(readSessionHistory(f.options), /ENOENT/u)
})

it("rejects repeated user submission identity instead of merging two rounds", async () => {
  const f = await fixture()
  f.records.filter((r) => r.type === "user_invocation")[1]!.submission_id = "s0"
  await f.save()
  await assert.rejects(readSessionHistory(f.options), /duplicate submission/u)
})

it("returns the current durable task snapshot even when task creation is outside the visible page", async () => {
  const f = await fixture()
  const time = Date.parse(at)
  f.records.splice(3, 0,
    { type: "todo_list_reset", reset_at_ms: time, new_summary: "验证任务" },
    { type: "todo_item_added", item: { id: "t-check", content: "检查接口", status: "pending", active_form: null, blocked_by: [], created_at_ms: time, updated_at_ms: time } },
  )
  f.records.splice(f.records.length - 1, 0, { type: "todo_item_updated", id: "t-check", updated_at_ms: time + 1, new_status: "completed", new_content: null, new_active_form: null, add_blocked_by: [], remove_blocked_by: [], evidence: "测试通过" })
  await f.save()
  const latest = await readSessionHistory({ ...f.options, limit: 1 })
  assert.equal(latest.turns.length, 1)
  assert.equal(latest.todoSnapshot?.items[0]?.status, "completed")
  assert.equal(latest.todoSnapshot?.summary, "验证任务")
  const older = await readSessionHistory({ ...f.options, limit: 1, cursor: latest.nextCursor! })
  assert.deepEqual(older.todoSnapshot, latest.todoSnapshot)
  f.records.push({ type: "todo_list_reset", reset_at_ms: time + 2, new_summary: null })
  await f.save()
  assert.deepEqual((await readSessionHistory(f.options)).todoSnapshot?.items, [])
})
