import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { initialSnapshot, type ChatPhase } from "../src/contract.ts"
import { phaseFlags, sessionIdle } from "../src/chat/chatPhase.ts"

type Row = [busy: boolean, turnActive: boolean, generating: boolean, connected: boolean]

/** 每个阶段一行，新增阶段时类型会要求补上这里的期望。 */
const expected: Record<ChatPhase, Row> = {
  disconnected: [false, false, false, false],
  connecting: [true, false, false, false],
  configuring: [true, false, false, true],
  loadingHistory: [true, false, false, true],
  sideQuestion: [true, false, false, true],
  ready: [false, false, false, true],
  sending: [true, true, false, true],
  running: [true, true, true, true],
  stopping: [true, true, true, true],
  failed: [false, false, false, false],
  closing: [false, false, false, false],
}

describe("ChatApp phase flags", () => {
  it("derives busy, turn, generating and connection flags for every phase", () => {
    for (const [phase, [busy, turnActive, generating, connected]] of Object.entries(expected) as [ChatPhase, Row][]) {
      assert.deepEqual(phaseFlags(phase), { busy, turnActive, generating, connected }, phase)
    }
  })

  it("keeps composer menus and new chat available only when nothing else is working", () => {
    const base = initialSnapshot()
    const idle = { phase: "ready" as const, backgroundBusy: false, sessionTools: base.sessionTools }
    assert.equal(sessionIdle(idle), true)
    assert.equal(sessionIdle({ ...idle, phase: "disconnected" }), true)
    assert.equal(sessionIdle({ ...idle, phase: "failed" }), true)
    for (const phase of ["connecting", "loadingHistory", "sending", "running", "stopping"] as const) assert.equal(sessionIdle({ ...idle, phase }), false, phase)
    assert.equal(sessionIdle({ ...idle, backgroundBusy: true }), false)
    assert.equal(sessionIdle({ ...idle, sessionTools: { ...base.sessionTools, busy: "compact" } }), false)
  })
})
