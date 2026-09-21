import assert from "node:assert/strict"
import { afterEach, it } from "node:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readSessionHistory, type ConversationItem } from "../src/index.ts"
import { projectHashForCwd } from "../src/shared/cli-adapter/records/cwd.ts"
import { createMutableTurn, freezeTurn, restoreMutableTurn, serializeMutableTurn } from "../src/shared/cli-adapter/records/turn/model.ts"
import { turnRecordHandler, type TurnRecordContext } from "../src/shared/cli-adapter/records/turn/records.ts"

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const at = "2026-09-20T00:00:00Z"
const request = { type: "turn_request", at, turn_index: 0, model: "fixture" }
const response = (text: string) => ({ type: "turn_response", at, response_json: { content: [{ type: "thinking", thinking: "audit reasoning" }, { type: "text", text }] } })
const thinking = { type: "thinking", at, text: "canonical reasoning" }
const answer = (text: string) => ({ type: "assistant_text", at, text })
const end = (stop_reason: unknown = "EndTurn") => ({ type: "turn_end", at, turn_index: 0, stop_reason })
const sequence = (items: readonly ConversationItem[]) => items.map(item => item.kind === "message" ? `${item.role}:${item.text}` : item.kind === "activity" ? `${item.activityType}:${item.text}` : item.kind)
async function read(records: readonly object[]) {
  const sessionsRoot = await mkdtemp(join(tmpdir(), "codem-response-order-")); roots.push(sessionsRoot)
  const cwd = "/workspace", threadId = "response-order"
  const directory = join(sessionsRoot, projectHashForCwd(cwd)); await mkdir(directory)
  const rows = [{ type: "header", schema_version: 13, session_id: threadId, cwd, started_at: at, model: "fixture", provider: "openai_compat" }, { type: "user_invocation", at, submission_id: "s", input: { kind: "message", content: "Question" } }, ...records]
  await writeFile(join(directory, `${threadId}.jsonl`), rows.map((row, i) => JSON.stringify({ ...row, record_seq: i + 1 })).join("\n") + "\n")
  return (await readSessionHistory({ sessionsRoot, cwd, threadId })).turns[0]!.turn
}

it("uses canonical reasoning and answer order instead of the earlier response audit position", async () => {
  const turn = await read([request, response("audit body"), thinking, answer("canonical body"), end()])
  assert.deepEqual(sequence(turn.items), ["user:Question", "reasoning:canonical reasoning", "assistant:canonical body"])
  assert.equal(turn.state, "completed")
  const body = turn.items.at(-1)!
  assert.ok(body.kind === "message" && body.role === "assistant" && body.delivery?.synthetic === false)
})
for (const [label, tail, state] of [
  ["EOF", [], "running"],
  ["interruption", [end("Cancelled")], "stopped"],
  ["provider failure", [{ type: "error", at, message: "provider failed" }], "failed"],
] as const) it(`retains missing canonical text after reasoning at ${label}`, async () => {
  const turn = await read([request, response("recoverable body"), thinking, ...tail])
  assert.deepEqual(sequence(turn.items).slice(0, 3), ["user:Question", "reasoning:canonical reasoning", "assistant:recoverable body"])
  assert.equal(turn.state, state)
})
it("keeps commentary before tools and the next response reasoning before its answer", async () => {
  const turn = await read([request, response("commentary"), thinking, answer("commentary"),
    { type: "tool_call", at, id: "read", name: "read_files", input: { files: [{ path: "README.md" }] } },
    { type: "tool_result", at, id: "read", status: "completed", content: "read" }, end("ToolUse"),
    request, response("final"), thinking, answer("final"), end(),
  ])
  assert.deepEqual(sequence(turn.items), ["user:Question", "reasoning:canonical reasoning", "assistant:commentary", "tool-execution", "reasoning:canonical reasoning", "assistant:final"])
})
it("recovers missing commentary before an executed tool rather than moving it after the tool", async () => {
  const turn = await read([request, response("commentary"), thinking,
    { type: "tool_call", at, id: "read", name: "read_files", input: {} },
    { type: "tool_result", at, id: "read", status: "completed", content: "read" }, end("Cancelled"),
  ])
  assert.deepEqual(sequence(turn.items), ["user:Question", "reasoning:canonical reasoning", "assistant:commentary", "tool-execution"])
})
it("does not depend on provider audit content when canonical records are present", async () => {
  const turn = await read([request, { type: "turn_response", at, response_json: { choices: [] } }, thinking, answer("body"), end()])
  assert.deepEqual(sequence(turn.items), ["user:Question", "reasoning:canonical reasoning", "assistant:body"])
})
it("rejects duplicate unresolved response candidates", async () => {
  await assert.rejects(read([request, response("one"), response("two"), end()]), /duplicate pending assistant response/)
})
it("previews an interrupted tail without consuming recovery, then restores canonical ordering from a checkpoint", () => {
  const context: TurnRecordContext = { path: "fixture", lineNumber: 1, durableSequenceRequired: false, backgroundTasks: new Map(), backgroundCompletions: new Map(), ownBackgroundTask: null, reviseSealedTurn: null }
  let turn = createMutableTurn("fixture", 0, { source: "user-invocation", inputKind: "message", submissionId: "s" }, at, "fixture", "fixture")
  const apply = (record: { type: string }) => turnRecordHandler(record.type)!.apply(turn, record, context)
  apply(response("audit body"))
  const checkpoint = serializeMutableTurn(turn)
  assert.deepEqual(sequence(freezeTurn(turn).items), ["assistant:audit body"])
  assert.deepEqual(serializeMutableTurn(turn), checkpoint, "Preview must not alter the incremental cursor state")
  turn = restoreMutableTurn(JSON.parse(JSON.stringify(checkpoint)))
  apply(thinking)
  assert.deepEqual(sequence(freezeTurn(turn).items), ["reasoning:canonical reasoning", "assistant:audit body"])
  apply(answer("canonical body"))
  assert.deepEqual(sequence(freezeTurn(turn).items), ["reasoning:canonical reasoning", "assistant:canonical body"])
  assert.equal(turn.pendingResponseAssistant, null)
})
