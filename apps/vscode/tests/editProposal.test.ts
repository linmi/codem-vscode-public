import assert from "node:assert/strict"
import { it } from "node:test"
import { EditProposal, editPrompt } from "../src/integrations/editProposal.ts"
const raw = (edits: { before: string; after: string }[]) => JSON.stringify({ edits: edits.map(edit => ({ ...edit, reason: "修复此处" })) })
it("mixed decisions preserve every unaccepted byte and remap following changes", () => {
  const original = "unsaved prefix\nfirst\nmiddle\nsecond\ntail"
  const proposal = new EditProposal(original, 15, original.length - 4, raw([{ before: "second", after: "" }, { before: "first", after: "first expanded\nline" }]))
  assert.equal(proposal.source(), original)
  assert.equal(proposal.preview(), "unsaved prefix\nfirst expanded\nline\nmiddle\n\ntail")
  const first = proposal.pending[0]!, second = proposal.pending[1]!
  proposal.choose([first.id], "accepted")
  assert.equal(proposal.offset(second), proposal.source().indexOf("second"))
  assert.equal(proposal.source().slice(0, 15), original.slice(0, 15))
  proposal.choose([second.id], "rejected")
  assert.equal(proposal.source(), "unsaved prefix\nfirst expanded\nline\nmiddle\nsecond\ntail")
  assert.equal(proposal.preview(), proposal.source())
  assert.throws(() => proposal.choose([first.id], "accepted"), /已处理/)
})
it("accepts anchored insertions and preserves CRLF and EOF", () => {
  const proposal = new EditProposal("a\r\nb", 0, 4, raw([{ before: "a\n", after: "a\ninsert\n" }]))
  proposal.choose(["1"], "accepted")
  assert.equal(proposal.source(), "a\r\ninsert\r\nb")
})
it("rejects ambiguous, overlapping, out-of-selection and malformed proposals atomically", () => {
  for (const changes of [
    [{ before: "foo", after: "x" }],
    [{ before: "foo foo", after: "x" }, { before: "foo foo end", after: "y" }],
    [{ before: "outside", after: "x" }],
    [{ before: "", after: "insert" }],
    [{ before: "end", after: "end" }],
    [{ before: "end", after: "bad\0" }],
  ]) assert.throws(() => new EditProposal("outside foo foo end", 8, 19, raw(changes)))
  for (const value of ["not json", "null", '{"edits":{}}', '{"edits":[{}]}', raw(Array(21).fill({ before: "a", after: "b" }))]) assert.throws(() => new EditProposal("a", 0, 1, value))
  assert.equal(new EditProposal("a", 0, 1, '{"edits":[]}').pending.length, 0)
  const proposal = new EditProposal("a b", 0, 3, raw([{ before: "a", after: "c" }, { before: "b", after: "d" }]))
  assert.throws(() => proposal.choose(["1", "invalid"], "accepted"))
  assert.equal(proposal.source(), "a b")
})
it("bounds selection and serialized prompt without truncating selected evidence", () => {
  const prompt = editPrompt("fixCode", "typescript", "const a = 1;\n", "x".repeat(3000), "y".repeat(3000), ["diagnostic"])
  const payload = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1))
  assert.equal(payload.selection, "const a = 1;\n")
  assert.equal(payload.contextBefore.length, 2000)
  assert.equal(payload.contextAfter.length, 2000)
  assert.throws(() => editPrompt("fixCode", "ts", "x".repeat(12001), "", "", []))
  assert.throws(() => editPrompt("fixCode", "ts", "x", "", "", ["x".repeat(32000)]))
})
