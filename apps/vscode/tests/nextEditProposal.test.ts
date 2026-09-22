import assert from "node:assert/strict"
import { it } from "node:test"
import { nextEditPrompt, parseNextEdit, type NextEditContext } from "../src/integrations/nextEdit/nextEditProposal.ts"
const context: NextEditContext = { language: "typescript", firstLine: 10, source: "const label = 1;\nprint(old);\nprint(old);", cursorLine: 10, recent: { before: "old", after: "label", line: 10 }, diagnostics: [] }
const proposal = (extra: object = {}) => JSON.stringify({ edit: { line: 12, before: "print(old);", after: "print(label);", reason: "同步引用", ...extra } })
it("anchors repeated source by explicit line, not first matching text", () => {
  assert.deepEqual(parseNextEdit(proposal(), context, 100), { start: 129, end: 140, before: "print(old);", after: "print(label);", reason: "同步引用" })
  assert.equal(parseNextEdit('{"edit":null}', context, 100), null)
  assert.match(nextEditPrompt(context), /recent/)
})
it("rejects unbounded, unknown, stale, out-of-window and no-op edits", () => {
  for (const raw of ['no json', '{"edits":[]}', '{"edit":null,"path":"secret"}', proposal({ line: 9 }), proposal({ line: 13 }), proposal({ line: 11.5 }), proposal({ before: "old" }), proposal({ after: "print(old);" }), proposal({ before: "" }), proposal({ after: "x".repeat(2001) }), proposal({ after: "x\n".repeat(21) }), proposal({ after: "\u0000" }), proposal({ path: "other.ts" })]) assert.throws(() => parseNextEdit(raw, context, 100))
  assert.throws(() => nextEditPrompt({ ...context, source: "x".repeat(12001) }))
})
it("preserves CRLF, supports anchored insertion and deletion", () => {
  const crlf = { ...context, source: "first\r\nsecond\r\nlast" }
  assert.deepEqual(parseNextEdit(proposal({ line: 11, before: "second\nlast", after: "replacement\nlast" }), crlf, 0), { start: 7, end: 19, before: "second\r\nlast", after: "replacement\r\nlast", reason: "同步引用" })
  assert.equal(parseNextEdit(proposal({ line: 11, before: "second", after: "" }), crlf, 0)?.after, "")
  assert.equal(parseNextEdit(proposal({ line: 11, before: "second", after: "new\nsecond" }), crlf, 0)?.after, "new\r\nsecond")
})
