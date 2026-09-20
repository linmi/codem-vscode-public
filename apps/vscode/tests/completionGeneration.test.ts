import assert from "node:assert/strict"
import { it } from "node:test"
import { completionPrompt, completionText } from "../src/integrations/completionGeneration.ts"
import { CompletionContinuation } from "../src/integrations/completionContinuation.ts"

it("completion context bounds header and cursor context and explicitly permits abstention", () => {
  const prompt = completionPrompt("typescript", "p".repeat(8000), "s".repeat(4000), "h".repeat(3000))
  const context = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1))
  assert.equal(context.prefix.length, 5000); assert.equal(context.suffix.length, 2000); assert.equal(context.fileHeader.length, 1500)
  assert.match(prompt, /smallest useful/); assert.match(prompt, /already complete/)
})

it("empty suggestions are valid, whitespace is preserved, exact suffix overlap is removed", () => {
  assert.equal(completionText('{"insertText":""}', "", ""), "")
  assert.equal(completionText('{"insertText":"  "}', "", ""), "")
  assert.equal(completionText('{"insertText":"  return a + b"}', "", ""), "  return a + b")
  assert.equal(completionText('{"insertText":"json()"}', "return response.", "();\n}"), "json")
  assert.equal(completionText('{"insertText":"min, value));"}', "Math.max(", "));\n}"), "min, value")
  assert.equal(completionText(JSON.stringify({ insertText: 'hello "' }), '"', '";'), 'hello ')
  assert.equal(completionText('{"insertText":"foo"}', "", "bar"), "foo")
})

it("malformed, excessive, prefix echoes and control characters are rejected rather than truncated", () => {
  for (const raw of ['[]', '{}', '{"insertText":null}', '```json\n{}\n```', JSON.stringify({ insertText: "a".repeat(513) }), JSON.stringify({ insertText: "line\n".repeat(9) }), JSON.stringify({ insertText: "\0" })]) assert.throws(() => completionText(raw, "", ""))
  assert.throws(() => completionText('{"insertText":"return a + b"}', "  return ", ""), /重复/)
})

it("one suggestion can only be reused for exact prefix typing before expiry", () => {
  let now = 0
  const candidate = new CompletionContinuation<object>(() => now), doc = {}
  candidate.remember(doc, 1, 10, "session:model", "a + b")
  assert.equal(candidate.read(doc, 1, 10, "session:model"), "a + b")
  candidate.changed(doc, 2, [{ rangeOffset: 10, rangeLength: 0, text: "a " }])
  assert.equal(candidate.read(doc, 2, 12, "session:model"), "+ b")
  candidate.changed(doc, 3, [{ rangeOffset: 12, rangeLength: 0, text: "+ b" }])
  assert.equal(candidate.read(doc, 3, 15, "session:model"), "")
  now = 15000; assert.equal(candidate.read(doc, 3, 15, "session:model"), null)
})

it("replacement, edits elsewhere, divergent typing, context/model changes and stale versions invalidate reuse", () => {
  const doc = {}, candidate = new CompletionContinuation<object>()
  for (const change of [{ rangeOffset: 10, rangeLength: 1, text: "a" }, { rangeOffset: 9, rangeLength: 0, text: "a" }, { rangeOffset: 10, rangeLength: 0, text: "x" }]) {
    candidate.remember(doc, 1, 10, "old", "abc"); candidate.changed(doc, 2, [change]); assert.equal(candidate.read(doc, 2, 11, "old"), null)
  }
  candidate.remember(doc, 1, 10, "old", "abc"); assert.equal(candidate.read(doc, 1, 10, "new-model"), null)
  candidate.remember(doc, 1, 10, "old", "abc"); assert.equal(candidate.read({}, 1, 10, "old"), null)
  candidate.remember(doc, 1, 10, "old", "abc"); assert.equal(candidate.read(doc, 2, 10, "old"), null)
})
