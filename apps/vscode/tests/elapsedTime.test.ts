import { it } from "node:test"
import assert from "node:assert/strict"
import { elapsedTime } from "../webview/status/elapsedTime.ts"
import { historyTurnTimings } from "../src/sessionHistory/historyMessages.ts"
import type { SessionHistoryPage } from "@codem/history"

it("formats elapsed duration, freezes completed turns and never displays negative elapsed time", () => {
  const running = { turnId: "turn", startedAt: 1000, finishedAt: null }
  assert.equal(elapsedTime(running, 37_000), "36秒")
  assert.equal(elapsedTime(running, 521_000), "8分 40秒")
  assert.equal(elapsedTime(running, 3_601_000), "1小时 0分 0秒")
  assert.equal(elapsedTime(running, 0), "0秒")
  assert.equal(elapsedTime({ ...running, finishedAt: 37_000 }, 900_000), "36秒")
})
it("uses durable timestamps on history reload and leaves unfinished duration unknown", () => {
  const base = { id: "turn", index: 0, engineTurnIndexes: [0], model: null, provider: null, usage: null, items: [], startedAt: "2026-09-20T00:00:00Z" }
  const page: SessionHistoryPage = { todoSnapshot: null, nextCursor: null, turns: [{ submissionId: "s", turn: { ...base, state: "completed", completedAt: "2026-09-20T00:00:36Z" } }] }
  assert.equal(elapsedTime(historyTurnTimings(page)[0]!, Date.now()), "36秒")
  assert.deepEqual(historyTurnTimings({ ...page, turns: [{ submissionId: "s", turn: { ...base, state: "running", completedAt: null } }] }), [])
})
