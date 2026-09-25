import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { initialSnapshot, type ChatPhase } from "../src/contract.ts"
import { phaseFlags, sessionIdle } from "../src/chat/chatPhase.ts"
import { commandUnavailable } from "../src/chat/slashCommands.ts"

type Row = [busy: boolean, turnActive: boolean, generating: boolean, connected: boolean, slashMenu: boolean]

/** 每个阶段一行，新增阶段时类型会要求补上这里的期望。 */
const expected: Record<ChatPhase, Row> = {
  disconnected: [false, false, false, false, true],
  connecting: [true, false, false, false, false],
  configuring: [true, false, false, true, false],
  loadingHistory: [true, false, false, true, false],
  sideQuestion: [true, false, false, true, true],
  ready: [false, false, false, true, true],
  sending: [true, true, false, true, false],
  running: [true, true, true, true, true],
  stopping: [true, true, true, true, false],
  failed: [false, false, false, false, true],
  closing: [false, false, false, false, true],
}

describe("ChatApp phase flags", () => {
  it("derives busy, turn, generating, connection and slash-menu flags for every phase", () => {
    for (const [phase, [busy, turnActive, generating, connected, slashMenu]] of Object.entries(expected) as [ChatPhase, Row][]) {
      assert.deepEqual(phaseFlags(phase), { busy, turnActive, generating, connected, slashMenu }, phase)
    }
  })

  it("opens the slash menu on typing during a side question, where the status line asks for /ask", () => {
    const base = initialSnapshot()
    const side = { ...base, phase: "sideQuestion" as const, threadId: "thread-1", sessionTools: { ...base.sessionTools, sideQuestion: { question: "q", answer: "", status: "running" as const } } }
    assert.equal(phaseFlags(side.phase).slashMenu, true)
    assert.equal(commandUnavailable("ask", side), null, "/ask must be selectable once the menu opens")
    // 运行中同理：输入 / 就能选 /steer。
    assert.equal(phaseFlags("running").slashMenu, true)
    assert.equal(commandUnavailable("steer", { ...base, phase: "running", threadId: "thread-1" }), null)
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
