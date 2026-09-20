import assert from "node:assert/strict"
import { it } from "node:test"
import { ComposerState } from "../webview/composerState.ts"

const context = { workspace: "workspace", space: "space", threadId: "thread" }
const receipt = (requestId: string, accepted = true) => ({ type: "sendResult" as const, requestId, accepted })

it("starts with saved drafts and restores the authoritative Host revision without sharing mutable state", () => {
  const saved = { draft: "saved", tools: { scope: JSON.stringify(Object.values(context)), mode: "shellCommand" as const, text: "pwd" } }
  const composer = new ComposerState(saved)
  saved.tools.text = "changed outside"
  assert.equal(composer.text, "saved")
  composer.setContext(context)
  composer.setMode("shellCommand")
  assert.equal(composer.text, "pwd")
  composer.restore({ draft: "host" }, "pending")
  assert.equal(composer.mode, "message")
  assert.equal(composer.busy, true)
  assert.deepEqual(composer.snapshot(), { draft: "host" })
  composer.settle(receipt("pending"))
  assert.equal(composer.text, "")
})

it("rejects duplicate submission, preserves failed drafts, and consumes only the matching retry", () => {
  const composer = new ComposerState()
  composer.edit("question")
  assert.equal(composer.begin("first"), true)
  assert.equal(composer.begin("duplicate"), false)
  composer.settle(receipt("first", false))
  assert.equal(composer.text, "question")
  assert.equal(composer.busy, false)
  assert.equal(composer.begin("retry"), true)
  composer.settle(receipt("first"))
  assert.equal(composer.busy, true)
  composer.settle(receipt("retry"))
  assert.equal(composer.text, "")
})

it("keeps newer edits, including retyped identical text, when an accepted receipt arrives", () => {
  const composer = new ComposerState({ draft: "same" })
  composer.begin("first")
  composer.edit("same")
  composer.settle(receipt("first"))
  assert.equal(composer.text, "same")
  composer.begin("second")
  composer.edit("newer")
  composer.settle(receipt("second"))
  assert.equal(composer.text, "newer")
})

it("preserves ordinary and recent tool drafts across modes without allowing old receipts to clear them", () => {
  const composer = new ComposerState({ draft: "ordinary" })
  composer.setContext(context)
  composer.setMode("askSideQuestion")
  composer.edit("side question")
  composer.begin("side")
  composer.setMode("message")
  composer.settle(receipt("side"))
  assert.equal(composer.text, "ordinary")
  composer.setMode("askSideQuestion")
  assert.equal(composer.text, "side question")
  composer.setMode("shellCommand")
  assert.equal(composer.text, "")
  composer.edit("pwd")
  const snapshot = composer.snapshot()
  snapshot.tools!.text = "external mutation"
  assert.equal(composer.text, "pwd")
  assert.equal(composer.snapshot().draft, "ordinary")
})

for (const key of ["workspace", "space", "threadId"] as const) {
  it(`retires tool submissions on ${key} changes without leaking drafts to another context`, () => {
    const composer = new ComposerState({ draft: "ordinary" })
    composer.setContext(context)
    composer.setMode("steer")
    composer.edit("old direction")
    composer.begin("old")
    composer.setContext({ ...context, [key]: "different" })
    assert.equal(composer.mode, "message")
    assert.equal(composer.busy, false)
    composer.begin("new")
    composer.settle(receipt("old"))
    assert.equal(composer.text, "ordinary")
    assert.equal(composer.busy, true)
    composer.settle(receipt("new", false))
    composer.setMode("steer")
    assert.equal(composer.text, "")
  })
}

it("keeps a first ordinary send pending while connection assigns workspace, space and thread", () => {
  const composer = new ComposerState({ draft: "first send" })
  composer.setContext({ workspace: null, space: null, threadId: null })
  composer.begin("first")
  composer.setContext(context)
  assert.equal(composer.busy, true)
  composer.settle(receipt("first"))
  assert.equal(composer.text, "")
})

it("reloads in message mode, preserves the scoped tool draft, and retires pre-restore receipts", () => {
  const previous = new ComposerState({ draft: "ordinary" })
  previous.setContext(context)
  previous.setMode("shellCommand")
  previous.edit("pwd")
  const reloaded = new ComposerState(previous.snapshot())
  reloaded.begin("stale")
  reloaded.restore(previous.snapshot(), "restored")
  reloaded.setContext(context)
  reloaded.settle(receipt("stale"))
  assert.equal(reloaded.text, "ordinary")
  assert.equal(reloaded.busy, true)
  reloaded.edit("edited after reload")
  reloaded.settle(receipt("restored"))
  assert.equal(reloaded.text, "edited after reload")
  reloaded.setMode("shellCommand")
  assert.equal(reloaded.text, "pwd")
})

it("appends context to the ordinary draft atomically and rejects oversized input without losing tool state", () => {
  const composer = new ComposerState({ draft: "ordinary" })
  composer.setContext(context)
  composer.setMode("shellCommand")
  composer.edit("pwd")
  const before = composer.snapshot()
  assert.throws(() => composer.append("x".repeat(32_000)), /32000/)
  assert.deepEqual(composer.snapshot(), before)
  assert.equal(composer.mode, "shellCommand")
  composer.append("context")
  assert.equal(composer.mode, "message")
  assert.equal(composer.text, "ordinary\n\ncontext")
  composer.setMode("shellCommand")
  assert.equal(composer.text, "pwd")
})
