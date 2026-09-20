import assert from "node:assert/strict"
import { it } from "node:test"
import { ComposerSubmission } from "../webview/composerSubmission.ts"

it("consumes a draft only on a matching successful receipt", () => {
  const submission = new ComposerSubmission()
  assert.equal(submission.begin("first"), true)
  assert.equal(submission.begin("duplicate"), false)
  assert.equal(submission.settle({ type: "sendResult", requestId: "stale", accepted: true }), false)
  assert.equal(submission.busy, true)
  assert.equal(submission.settle({ type: "sendResult", requestId: "first", accepted: false }), false)
  assert.equal(submission.busy, false)
  submission.begin("retry")
  assert.equal(submission.settle({ type: "sendResult", requestId: "first", accepted: true }), false)
  assert.equal(submission.settle({ type: "sendResult", requestId: "retry", accepted: true }), true)
  assert.equal(submission.settle({ type: "sendResult", requestId: "retry", accepted: true }), false)
})

it("preserves newer edits even when they contain the same text as the sent draft", () => {
  const submission = new ComposerSubmission()
  submission.begin("first")
  submission.edited()
  assert.equal(submission.settle({ type: "sendResult", requestId: "first", accepted: true }), false)
  assert.equal(submission.busy, false)
})

it("retires pending receipts when switching input context", () => {
  const submission = new ComposerSubmission()
  submission.begin("old-steer")
  submission.reset()
  assert.equal(submission.busy, false)
  submission.begin("new-message")
  assert.equal(submission.settle({ type: "sendResult", requestId: "old-steer", accepted: true }), false)
  assert.equal(submission.busy, true)
  assert.equal(submission.settle({ type: "sendResult", requestId: "new-message", accepted: true }), true)
})
