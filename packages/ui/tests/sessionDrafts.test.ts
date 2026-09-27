import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { draftSessionKey, emptySessionDrafts, enterSession, newSessionKey, parseSessionDrafts, settleStashedSend, type SessionDrafts } from "../src/chat/sessionDrafts.ts"

const a = "thread:a"
const b = "thread:b"

describe("per-session drafts", () => {
  it("keys the composer by thread and ignores transient connection states", () => {
    assert.equal(draftSessionKey({ phase: "ready", threadId: "a" }), a)
    assert.equal(draftSessionKey({ phase: "loadingHistory", threadId: "a" }), a)
    assert.equal(draftSessionKey({ phase: "ready", threadId: null }), newSessionKey)
    // 重连和恢复上次会话时 threadId 短暂为 null，不能当成切到新会话。
    for (const phase of ["disconnected", "connecting", "failed", "closing"] as const) {
      assert.equal(draftSessionKey({ phase, threadId: null }), null)
      assert.equal(draftSessionKey({ phase, threadId: "a" }), null)
    }
  })

  it("stashes the outgoing draft and brings back the target session's draft", () => {
    let sessions: SessionDrafts = { current: a, others: {} }
    let entry = enterSession(sessions, "A 的草稿", b, null)
    assert.equal(entry.draft, "")
    assert.deepEqual(entry.sessions, { current: b, others: { [a]: "A 的草稿" } })
    sessions = entry.sessions
    entry = enterSession(sessions, "B 的草稿", a, null)
    assert.equal(entry.draft, "A 的草稿")
    assert.deepEqual(entry.sessions, { current: a, others: { [b]: "B 的草稿" } })
    // 空草稿不占暂存位置。
    entry = enterSession(entry.sessions, "", newSessionKey, null)
    assert.deepEqual(entry.sessions.others, { [b]: "B 的草稿" })
    // 同一会话不交换，原对象原样返回。
    assert.equal(enterSession(entry.sessions, "x", newSessionKey, null).sessions, entry.sessions)
  })

  it("adopts the first session without swapping, so a restored draft stays put", () => {
    const pending = { requestId: "req-1", text: "恢复的草稿", session: null }
    const entry = enterSession({ current: null, others: { [a]: "旧的" } }, "恢复的草稿", a, pending)
    assert.equal(entry.draft, "恢复的草稿")
    assert.deepEqual(entry.sessions, { current: a, others: {} })
    assert.equal(entry.pending?.session, a)
  })

  it("carries the draft and pending send into the thread its first message creates", () => {
    const pending = { requestId: "req-1", text: "第一条", session: newSessionKey }
    const entry = enterSession({ current: newSessionKey, others: {} }, "第一条", a, pending)
    assert.equal(entry.draft, "第一条")
    assert.deepEqual(entry.sessions, { current: a, others: {} })
    assert.deepEqual(entry.pending, { ...pending, session: a })
    // 没有待确认发送时，从新会话打开历史会话是普通切换。
    const opened = enterSession({ current: newSessionKey, others: { [a]: "A" } }, "新会话草稿", a, null)
    assert.equal(opened.draft, "A")
    assert.deepEqual(opened.sessions.others, { [newSessionKey]: "新会话草稿" })
  })

  it("settles a late receipt against the draft stashed for the session that sent it", () => {
    const pending = { requestId: "req-1", text: "发出的消息", session: a }
    const stashed: SessionDrafts = { current: b, others: { [a]: "发出的消息" } }
    assert.deepEqual(settleStashedSend(stashed, pending, { kind: "accepted" }).others, {})
    assert.deepEqual(settleStashedSend({ current: b, others: {} }, pending, { kind: "restore", text: "发出的消息" }).others, { [a]: "发出的消息" })
    const edited: SessionDrafts = { current: b, others: { [a]: "改过的" } }
    assert.equal(settleStashedSend(edited, pending, { kind: "accepted" }), edited)
    assert.equal(settleStashedSend(edited, pending, { kind: "preserve" }), edited)
  })

  it("parses saved values defensively and bounds how much is kept", () => {
    assert.equal(parseSessionDrafts(null), emptySessionDrafts)
    assert.equal(parseSessionDrafts([]), emptySessionDrafts)
    assert.deepEqual(parseSessionDrafts({ current: "/etc/passwd", others: { "../x": "y", [a]: 3, [b]: "B" } }), { current: null, others: { [b]: "B" } })
    // current 自己的草稿在输入框里，不重复暂存。
    assert.deepEqual(parseSessionDrafts({ current: a, others: { [a]: "A", [b]: "B" } }), { current: a, others: { [b]: "B" } })
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`thread:${index}`, `草稿 ${index}`]))
    const bounded = parseSessionDrafts({ current: null, others: many })
    assert.equal(Object.keys(bounded.others).length, 20)
    assert.equal(bounded.others["thread:0"], undefined, "the earliest stashed drafts go first")
    assert.equal(bounded.others["thread:24"], "草稿 24")
    const large = parseSessionDrafts({ current: null, others: { "thread:1": "x".repeat(30_000), "thread:2": "y".repeat(30_000), "thread:3": "z".repeat(30_000) } })
    assert.deepEqual(Object.keys(large.others), ["thread:2", "thread:3"])
  })
})
