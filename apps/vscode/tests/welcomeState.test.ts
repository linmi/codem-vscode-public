import assert from "node:assert/strict"
import { it } from "node:test"
import { welcomeState } from "../webview/status/welcomeState.ts"

it("keeps initial and restored welcome static until a real connection begins", () => {
  for (const phase of ["disconnected", "ready"] as const)
    assert.deepEqual(welcomeState(phase, false, false, "idle"), { visible: true, motion: "idle" })
  assert.deepEqual(welcomeState("connecting", false, true, "idle"), { visible: true, motion: "initializing" })
})

it("settles successful initialization once, and clears motion on failure or cancellation", () => {
  assert.deepEqual(welcomeState("ready", false, false, "initializing"), { visible: true, motion: "settled" })
  assert.deepEqual(welcomeState("ready", false, false, "settled"), { visible: true, motion: "settled" })
  for (const previous of ["initializing", "settled"] as const)
    assert.deepEqual(welcomeState("disconnected", false, false, previous), { visible: true, motion: "idle" })
  assert.deepEqual(welcomeState("connecting", false, true, "settled"), { visible: true, motion: "initializing" })
})

it("retires welcome motion when messages or another interaction take over", () => {
  for (const phase of ["connecting", "ready", "disconnected"] as const)
    assert.deepEqual(welcomeState(phase, true, false, "initializing"), { visible: false, motion: "idle" })
  for (const phase of ["sending", "running", "stopping", "loadingHistory"] as const)
    assert.deepEqual(welcomeState(phase, false, false, "initializing"), { visible: false, motion: "idle" })
  assert.deepEqual(welcomeState("ready", false, true, "initializing"), { visible: false, motion: "idle" })
})
