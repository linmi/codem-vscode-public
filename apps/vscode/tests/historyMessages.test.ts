import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, writeFile, appendFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { it } from "node:test"
import type { SessionHistoryPage } from "@codem/session-history"
import { historyMessages } from "../src/historyMessages.ts"
import { createSessionHistoryReader } from "../src/sessionHistory.ts"

const at = "2026-09-19T00:00:00Z"

it("reads real schema 13 pages, projects safe display fields and keeps chronological message identity", async () => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "codem-vscode-history-")))
  try {
    const cwd = join(temporary, "workspace")
    const sessionsRoot = join(temporary, "sessions")
    const directory = join(sessionsRoot, createHash("sha256").update(cwd.replaceAll("\\", "/")).digest("hex").slice(0, 16))
    await mkdir(directory, { recursive: true })
    const path = join(directory, "thread-1.jsonl")
    const records: Record<string, unknown>[] = [{ type: "header", schema_version: 13, session_id: "thread-1", cwd, started_at: at, model: "fixture-model", provider: "openai_compat" }]
    for (let i = 0; i < 32; i++) records.push(
      { type: "user_invocation", at, submission_id: `submission-${i}`, input: { kind: "message", content: `question ${i}` } },
      { type: "turn_request", at, turn_index: i, model: "fixture-model" },
      { type: "user_message", at, origin: "synthetic", content: "hidden model context" },
      { type: "assistant_text", at, text: ` answer ${i}\n ` },
      { type: "tool_call", at, id: `call-${i}`, name: "final_answer", input: { kind: "chat", status: "complete", summary: `final ${i}` } },
      { type: "tool_result", at, id: `call-${i}`, status: "completed", content: "accepted" },
      { type: "turn_end", at, turn_index: i, stop_reason: "EndTurn" },
    )
    await writeFile(path, records.map((record, i) => JSON.stringify({ ...record, record_seq: i + 1 })).join("\n") + "\n")
    let authorizations = 0
    const read = createSessionHistoryReader({ cwd, sessionsRoot, authorize: async () => { authorizations++ } })
    const signal = new AbortController().signal
    const newest = await read("thread-1", undefined, signal)
    assert.equal(newest.turns.length, 30)
    assert.ok(newest.nextCursor)
    const oldest = await read("thread-1", newest.nextCursor, signal)
    assert.equal(oldest.turns.length, 2)
    assert.equal(oldest.nextCursor, null)
    const messages = [...historyMessages("thread-1", oldest), ...historyMessages("thread-1", newest)]
    assert.deepEqual(messages.filter((message) => message.role === "user").map((message) => message.text), Array.from({ length: 32 }, (_, i) => `question ${i}`))
    assert.equal(new Set(messages.map((message) => message.id)).size, messages.length)
    assert.equal(messages.find((message) => message.role === "assistant")?.text, " answer 0\n ")
    assert.equal(messages.filter((message) => message.text === "final 0").length, 1)
    assert.doesNotMatch(JSON.stringify(messages), /hidden model context|final_answer|sessionsRoot|record_seq|openai_compat/)
    assert.ok(messages.every((message) => Object.keys(message).sort().join(",") === "id,label,role,text"))
    assert.equal(authorizations, 2)
    await appendFile(path, '{"type":')
    await assert.rejects(read("thread-1", newest.nextCursor, signal), /changed or cursor/)
    await assert.rejects(read("../thread-1", undefined, signal), /session id/)
  } finally { await rm(temporary, { recursive: true, force: true }) }
})

it("requires fresh authorization and cancellation checks before reading local history", async () => {
  let authorizations = 0
  const read = createSessionHistoryReader({ cwd: "/workspace", sessionsRoot: "/must-not-read", authorize: async () => { authorizations++; throw new Error("not authorized") } })
  await assert.rejects(read("thread-1", undefined, new AbortController().signal), /not authorized/)
  assert.equal(authorizations, 1)
  await assert.rejects(read("thread-1", undefined, AbortSignal.abort()), /abort/i)
  assert.equal(authorizations, 1)
  const abort = new AbortController()
  const delayed = createSessionHistoryReader({ cwd: "/workspace", sessionsRoot: "/must-not-read", authorize: async () => { abort.abort() } })
  await assert.rejects(delayed("thread-1", undefined, abort.signal), /abort/i)
})

it("renders reasoning and tool results without exposing execution inputs or diagnostic objects", () => {
  const page: SessionHistoryPage = { nextCursor: null, turns: [{ submissionId: "submission", turn: {
    id: "turn", index: 0, engineTurnIndexes: [0], model: "fixture", provider: "fixture", startedAt: at, completedAt: at, state: "completed", usage: null,
    items: [
      { id: "reasoning", at, kind: "activity", activityType: "reasoning", redacted: false, text: "reasoning text" },
      { id: "tool", at, kind: "tool-execution", toolCallId: "call", toolName: "read_files", input: { value: "/host-only/path", preview: "/host-only/path", previewTruncated: false }, result: { value: "file contents", preview: "file contents", previewTruncated: false }, status: "succeeded" },
      { id: "failure", at, kind: "error", cause: "ui-failure", failure: { code: "private-code", operation: "private-operation", retryable: false, diagnosticId: "private-id" } },
    ],
  } }] }
  const messages = historyMessages("thread-1", page)
  assert.deepEqual(messages.map((message) => [message.role, message.label, message.text]), [["reasoning", "思考过程", "reasoning text"], ["tool", "read_files · 已完成", "file contents"], ["tool", "历史错误", "历史操作失败。"]])
  assert.doesNotMatch(JSON.stringify(messages), /host-only|private-code|private-operation|private-id/)
})
