import assert from "node:assert/strict"
import { it } from "node:test"
import { compareDiff } from "../src/resources/diffComparison.ts"
import type { FileDiffContent } from "../src/resources/filePresentation.ts"
const modified: FileDiffContent = { path: "file", changeType: "modified", stats: { linesAdded: 1, linesRemoved: 1 }, preview: { kind: "complete", hunks: [{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1, lines: [{ kind: "delete", text: "old", oldLine: 2, newLine: null }, { kind: "insert", text: "new", oldLine: null, newLine: 2 }] }] } }
it("rebuilds before content only when every new hunk matches; compares lines independently of EOL", () => {
  assert.deepEqual(compareDiff(modified, "head\r\nnew\r\ntail\r\n"), { kind: "comparison", before: "head\nold\ntail", after: "head\nnew\ntail" })
  assert.equal(compareDiff(modified, "head\nchanged later\ntail").kind, "patch")
  assert.equal(compareDiff(modified, null).kind, "patch")
  assert.equal(compareDiff({ ...modified, preview: { kind: "partial", hunks: [] } }, "content").kind, "patch")
  assert.equal(compareDiff({ ...modified, preview: { kind: "binary" } }, "content").kind, "patch")
})
it("handles complete additions and deletions, rejecting incomplete new-file context", () => {
  const added: FileDiffContent = { ...modified, changeType: "new", preview: { kind: "complete", hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, lines: [{ kind: "insert", text: "new", oldLine: null, newLine: 1 }] }] } }
  assert.deepEqual(compareDiff(added, "new\n"), { kind: "comparison", before: "", after: "new" })
  assert.equal(compareDiff(added, "new\nextra\n").kind, "patch")
  const deleted: FileDiffContent = { ...modified, changeType: "deleted", preview: { kind: "complete", hunks: [{ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0, lines: [{ kind: "delete", text: "old", oldLine: 1, newLine: null }] }] } }
  assert.deepEqual(compareDiff(deleted, null), { kind: "comparison", before: "old", after: "" })
})
