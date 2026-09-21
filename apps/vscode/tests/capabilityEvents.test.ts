import assert from "node:assert/strict"
import { it } from "node:test"
import { capabilityFixture } from "./capabilityFixtures.ts"

it("projects run status without disclosing hook commands, guard payloads or foreign events", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("hello")
  f.emit({ type: "plan-updated", threadId: "other", turnId: "turn-1", plan: [{ content: "foreign", status: "pending" }] })
  f.emit({ type: "plan-updated", threadId: "thread-1", turnId: "turn-1", plan: [{ content: "实现", status: "in_progress" }] })
  f.emit({ type: "usage-updated", threadId: "thread-1", inputTokens: 12, outputTokens: 3, cacheReadTokens: null, cacheCreationTokens: 0 })
  f.emit({ type: "hook-completed", threadId: "thread-1", turnId: "turn-1", eventName: "PreToolUse", toolName: "write", command: "/secret/script TOKEN=secret", outcome: "allow", reason: "secret", elapsedMs: 12 })
  f.emit({ type: "tool-guard", threadId: "thread-1", turnId: "turn-1", itemId: "tool", guard: { toolName: "read", toolCallId: "call", status: "truncated", reason: "secret", rawResultBytes: 100, returnedResultBytes: 10, formattedCapBytes: 10, globalBackstopApplied: true, suggestion: "secret" } })
  f.emit({ type: "diff-updated", threadId: "thread-1", turnId: "turn-1", files: [{ path: "/workspace/src/a.ts", linesAdded: 3, linesRemoved: 1 }] })
  const state = f.controller.snapshot().capabilities
  assert.deepEqual(state.plan, [{ content: "实现", status: "in_progress" }])
  assert.equal(state.usage?.cacheRead, null); assert.equal(state.usage?.cacheWrite, 0)
  assert.equal(state.guards[0]?.returnedBytes, 10)
  assert.equal(state.changes[0]?.label, "src/a.ts")
  assert.doesNotMatch(JSON.stringify(state), /secret|foreign|\/workspace/)
  f.finish()
  f.emit({ type: "plan-updated", threadId: "thread-1", turnId: "turn-1", plan: [] })
  assert.equal(f.controller.snapshot().capabilities.plan.length, 1)
  await f.controller.send("next")
  assert.equal(f.controller.snapshot().capabilities.plan.length, 1)
  f.finish(); await f.controller.newChat()
  assert.equal(f.controller.snapshot().capabilities.usage, null)
  assert.deepEqual(f.controller.snapshot().capabilities.plan, [])
})

it("external thread closure revokes its active UI and ignores subsequent deltas", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("hello")
  f.emit({ type: "thread-closed", cwd: "/workspace", threadId: "thread-1", reason: "thread/archived" })
  assert.equal(f.controller.snapshot().threadId, null)
  assert.equal(f.controller.snapshot().phase, "ready")
  f.emit({ type: "text-delta", threadId: "thread-1", turnId: "turn-1", itemId: "late", delta: "stale" })
  assert.equal(f.controller.snapshot().messages.length, 1)
})

it("keeps the authoritative task list through failed/cancelled turns and replaces or clears it only on Core updates", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("开始")
  const plan = [{ content: "核对接口", status: "completed" }, { content: "实现页面", status: "in_progress" }, { content: "验证", status: "pending" }]
  f.emit({ type: "plan-updated", threadId: "thread-1", turnId: "turn-1", plan })
  f.emit({ type: "plan-updated", threadId: "thread-1", turnId: "stale", plan: [] })
  assert.deepEqual(f.controller.snapshot().capabilities.plan, plan)
  f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-1", outcome: "failed", stopReason: "error", error: "fixture" })
  assert.deepEqual(f.controller.snapshot().capabilities.plan, plan)
  await f.controller.send("继续")
  assert.deepEqual(f.controller.snapshot().capabilities.plan, plan)
  f.emit({ type: "plan-updated", threadId: "thread-1", turnId: "turn-2", plan: [{ content: "重新设计", status: "pending" }] })
  assert.equal(f.controller.snapshot().capabilities.plan.length, 1)
  await f.controller.stop()
  f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "turn-2", outcome: "stopped", stopReason: "cancelled", error: null })
  assert.deepEqual(f.controller.snapshot().capabilities.plan, [{ content: "重新设计", status: "pending" }])
  f.emit({ type: "thread-cleared", threadId: "thread-1" })
  assert.deepEqual(f.controller.snapshot().capabilities.plan, [])
})
