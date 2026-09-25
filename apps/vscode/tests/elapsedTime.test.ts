import { it } from "node:test"
import assert from "node:assert/strict"
import { elapsedTime } from "@codem/ui/contract"
import { historyTurnTimings } from "../src/sessionHistory/historyMessages.ts"
import type { SessionHistoryPage } from "@codem/history"

it("uses durable timestamps on history reload and leaves unfinished duration unknown", () => {
  const base = { id: "turn", index: 0, engineTurnIndexes: [0], model: null, provider: null, usage: null, items: [], startedAt: "2026-09-20T00:00:00Z" }
  const page: SessionHistoryPage = { todoSnapshot: null, nextCursor: null, turns: [{ submissionId: "s", turn: { ...base, state: "completed", completedAt: "2026-09-20T00:00:36Z" } }] }
  assert.equal(elapsedTime(historyTurnTimings(page)[0]!, Date.now()), "36秒")
  assert.deepEqual(historyTurnTimings({ ...page, turns: [{ submissionId: "s", turn: { ...base, state: "running", completedAt: null } }] }), [])
})
