import assert from "node:assert/strict"
import { it } from "node:test"
import { SelectedCodeState, type SelectedCode } from "../src/resources/selectedCode.ts"
import { parseViewAction } from "../src/shared/messages.ts"

const source = (key = "first"): SelectedCode => ({ key, uri: "file:///workspace/src/code.ts", version: 1, start: { line: 9, character: 0 }, end: { line: 15, character: 0 }, context: { path: "src/code.ts", language: "typescript", startLine: 10, endLine: 15, text: "  const a = 1\n", diagnostics: [] } })
it("projects only selection metadata and sends an immutable source snapshot", () => {
  const state = new SelectedCodeState(() => {})
  const captured = source()
  state.capture(captured)
  const view = state.snapshot()!
  assert.deepEqual(Object.keys(view).sort(), ["endLine", "error", "id", "label", "path", "startLine"])
  assert.equal(view.label, "code.ts")
  captured.context.text = "unrelated later content"
  assert.match(state.prompt(view.id, "解释一下"), /解释一下\n\n参考以下代码：[\s\S]*src\/code.ts:10-15[\s\S]*  const a = 1\n/)
  assert.doesNotMatch(state.prompt(view.id, "解释一下"), /unrelated/)
  assert.throws(() => state.prompt("unknown-id", "hi"), /选区已变化/)
})
it("does not resurrect removed selections on focus and never consumes a newer selection", () => {
  const state = new SelectedCodeState(() => {})
  state.capture(source())
  const first = state.snapshot()!.id
  state.remove(first)
  state.capture(source())
  assert.equal(state.snapshot(), null)
  state.capture(source("next"))
  const next = state.snapshot()!.id
  state.remove(first)
  assert.equal(state.snapshot()!.id, next)
  assert.throws(() => state.read(first))
  state.invalidate("file:///different")
  assert.equal(state.snapshot()!.id, next)
  state.invalidate(source().uri)
  assert.equal(state.snapshot(), null)
})
it("retains a selection through first connection but clears it on conversation changes", () => {
  const state = new SelectedCodeState(() => {})
  state.setContext({ workspace: null, space: null, threadId: null })
  state.capture(source())
  state.setContext({ workspace: "workspace", space: "team", threadId: "first" })
  assert.ok(state.snapshot())
  state.setContext({ workspace: "workspace", space: "team", threadId: "second" })
  assert.equal(state.snapshot(), null)
})
it("reports oversize selections and rejects oversize combined prompts without losing context", () => {
  const state = new SelectedCodeState(() => {})
  const large = source()
  large.context.text = "x".repeat(24001)
  state.capture(large)
  assert.match(state.snapshot()!.error!, /24000/)
  assert.throws(() => state.prompt(state.snapshot()!.id, "hi"))
  state.capture(source("valid"))
  assert.throws(() => state.prompt(state.snapshot()!.id, "x".repeat(31999)), /32000/)
  assert.ok(state.snapshot())
})
it("accepts only selection handles, never caller-supplied code or paths", () => {
  const action = { type: "send", text: "解释一下", requestId: "request", selectionId: "selected-id" }
  assert.deepEqual(parseViewAction(action), action)
  for (const selectionId of [null, "", "../file", "x".repeat(101), 42]) assert.throws(() => parseViewAction({ ...action, selectionId }))
  assert.throws(() => parseViewAction({ ...action, code: "injected" }))
  for (const type of ["removeCodeSelection", "revealCodeSelection"]) {
    assert.deepEqual(parseViewAction({ type, id: "selected-id" }), { type, id: "selected-id" })
    assert.throws(() => parseViewAction({ type, id: "selected-id", path: "/private" }))
  }
})
