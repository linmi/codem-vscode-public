import assert from "node:assert/strict"
import { it } from "node:test"
import { SelectedCodeState, type SelectedCode } from "../src/resources/selectedCode.ts"
import { codePrompt } from "../src/shared/editorContext.ts"
import { parseViewAction } from "../src/shared/messages.ts"

const source = (key = "first"): SelectedCode => ({ key, uri: "file:///workspace/src/code.ts", version: 1, start: { line: 9, character: 0 }, end: { line: 15, character: 0 }, context: { path: "src/code.ts", language: "typescript", startLine: 10, endLine: 15, text: "  const a = 1\n", diagnostics: [] } })
it("projects only selection metadata and sends an immutable source snapshot", () => {
  const state = new SelectedCodeState(() => {})
  const captured = source()
  state.capture(captured)
  const view = state.snapshot().current!
  assert.deepEqual(Object.keys(view).sort(), ["endLine", "error", "id", "label", "path", "startLine"])
  assert.equal(view.label, "code.ts")
  captured.context.text = "unrelated later content"
  assert.match(state.prompt([view.id], "解释一下"), /解释一下\n\n参考以下代码：[\s\S]*src\/code.ts:10-15[\s\S]*  const a = 1\n/)
  assert.doesNotMatch(state.prompt([view.id], "解释一下"), /unrelated/)
  assert.throws(() => state.prompt(["unknown-id"], "hi"), /选区已变化/)
})
it("does not resurrect removed selections on focus and never consumes a newer selection", () => {
  const state = new SelectedCodeState(() => {})
  state.capture(source())
  const first = state.snapshot().current!.id
  state.remove(first)
  state.capture(source())
  assert.equal(state.snapshot().current, null)
  state.capture(source("next"))
  const next = state.snapshot().current!.id
  state.remove(first)
  assert.equal(state.snapshot().current!.id, next)
  assert.throws(() => state.read(first))
  state.invalidate("file:///different")
  assert.equal(state.snapshot().current!.id, next)
  state.invalidate(source().uri)
  assert.equal(state.snapshot().current, null)
})
it("retains a selection through first connection but clears it on conversation changes", () => {
  const state = new SelectedCodeState(() => {})
  state.setContext({ workspace: null, space: null, threadId: null })
  state.capture(source())
  state.setContext({ workspace: "workspace", space: "team", threadId: "first" })
  assert.ok(state.snapshot().current)
  state.setContext({ workspace: "workspace", space: "team", threadId: "second" })
  assert.equal(state.snapshot().current, null)
})
it("reports oversize selections and rejects oversize combined prompts without losing context", () => {
  const state = new SelectedCodeState(() => {})
  const large = source()
  large.context.text = "x".repeat(24001)
  state.capture(large)
  assert.match(state.snapshot().current!.error!, /24000/)
  assert.throws(() => state.prompt([state.snapshot().current!.id], "hi"))
  state.capture(source("valid"))
  assert.throws(() => state.prompt([state.snapshot().current!.id], "x".repeat(31999)), /32000/)
  assert.ok(state.snapshot().current)
})
it("accepts only selection handles, never caller-supplied code or paths", () => {
  const action = { type: "send", text: "解释一下", requestId: "request", selectionIds: ["selected-id"] }
  assert.deepEqual(parseViewAction(action), action)
  for (const selectionIds of [null, "selected-id", [], [""], ["../file"], ["x".repeat(101)], [42], ["a", "a"], Array.from({ length: 22 }, (_, i) => `id-${i}`)]) assert.throws(() => parseViewAction({ ...action, selectionIds }))
  assert.throws(() => parseViewAction({ type: "send", text: "hi", requestId: "request", selectionId: "old-id" }))
  assert.throws(() => parseViewAction({ ...action, code: "injected" }))
  for (const type of ["removeCodeSelection", "revealCodeSelection", "pinCodeSelection"]) {
    assert.deepEqual(parseViewAction({ type, id: "selected-id" }), { type, id: "selected-id" })
    assert.throws(() => parseViewAction({ type, id: "selected-id", path: "/private" }))
  }
})

it("pinned snapshots survive file switches, edits, closes and repeated capture without duplicates", () => {
  const state = new SelectedCodeState(() => {})
  const original = source()
  state.capture(original)
  const first = state.snapshot().current!.id
  state.pin(first); state.pin(first)
  original.context.text = "later code"
  state.capture(null)
  state.capture(source())
  assert.equal(state.snapshot().current, null)
  assert.equal(state.snapshot().pinned.length, 1)
  const second = { ...source("second"), uri: "file:///workspace/other.ts", context: { ...source().context, path: "other.ts", text: "second()" } }
  state.capture(second)
  const secondId = state.snapshot().current!.id
  state.pin(secondId)
  state.invalidate(original.uri); state.invalidate(second.uri)
  const view = state.snapshot()
  assert.equal(view.pinned.length, 2)
  assert.match(state.prompt([first, secondId], "compare"), /const a = 1[\s\S]*other.ts[\s\S]*second\(\)/)
  assert.doesNotMatch(state.prompt([first], ""), /later code/)
  view.pinned[0]!.label = "tampered view"
  assert.equal(state.snapshot().pinned[0]!.label, "code.ts")
  state.remove(first)
  assert.deepEqual(state.snapshot().pinned.map(item => item.id), [secondId])
  state.clear()
  assert.deepEqual(state.snapshot(), { current: null, pinned: [] })
})
it("failed pinning is atomic and bounded, while contexts clear all pinned references", () => {
  const state = new SelectedCodeState(() => {})
  state.setContext({ workspace: null, space: null, threadId: null })
  for (let i = 0; i < 20; i++) { state.capture(source(`source-${i}`)); state.pin(state.snapshot().current!.id) }
  state.capture(source("limit"))
  const current = state.snapshot().current!.id
  assert.throws(() => state.pin(current), /20/)
  assert.equal(state.snapshot().current!.id, current)
  state.setContext({ workspace: "workspace", space: "space", threadId: "first" })
  assert.equal(state.snapshot().pinned.length, 20)
  state.setContext({ workspace: "workspace", space: "space", threadId: "second" })
  assert.deepEqual(state.snapshot(), { current: null, pinned: [] })
  state.capture({ ...source("large1"), context: { ...source().context, text: "a".repeat(20000) } })
  state.pin(state.snapshot().current!.id)
  state.capture({ ...source("large2"), context: { ...source().context, text: "b".repeat(20000) } })
  assert.throws(() => state.pin(state.snapshot().current!.id), /32000/)
  assert.equal(state.snapshot().pinned.length, 1)
  assert.ok(state.snapshot().current)
})

it("explicit editor actions consume only matching snapshot references after insertion", () => {
  const state = new SelectedCodeState(() => {})
  const selected = source()
  state.capture(selected)
  const pinned = state.snapshot().current!.id
  state.pin(pinned)
  state.capture({ ...source("next"), context: { ...selected.context, startLine: 30, endLine: 35 } })
  const text = codePrompt("explainCode", selected.context)
  assert.deepEqual(state.matchingIds(selected.uri, text), [pinned])
  assert.deepEqual(state.matchingIds("file:///other", text), [])
  assert.deepEqual(state.matchingIds(selected.uri, "ordinary terminal output"), [])
  assert.equal(state.snapshot().pinned.length, 1, "Looking up an insertion does not consume it on failure")
  for (const id of state.matchingIds(selected.uri, text)) state.remove(id)
  assert.equal(state.snapshot().pinned.length, 0)
  assert.ok(state.snapshot().current)
})
