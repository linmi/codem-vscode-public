import { it } from "node:test"
import assert from "node:assert/strict"
import { elapsedTime } from "../src/contract.ts"

it("formats elapsed duration, freezes completed turns and never displays negative elapsed time", () => {
  const running = { turnId: "turn", startedAt: 1000, finishedAt: null }
  assert.equal(elapsedTime(running, 37_000), "36秒")
  assert.equal(elapsedTime(running, 521_000), "8分40秒")
  assert.equal(elapsedTime(running, 3_601_000), "1小时0分")
  assert.equal(elapsedTime(running, 0), "0秒")
  assert.equal(elapsedTime({ ...running, finishedAt: 37_000 }, 900_000), "36秒")
})
