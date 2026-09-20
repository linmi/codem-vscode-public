import assert from "node:assert/strict"
import { it } from "node:test"
import { appendContext, codePrompt } from "../src/editorContext.ts"
it("captures code whitespace and includes diagnostics only for repair", () => {
  const context = { path: "src/main.ts", language: "typescript", startLine: 2, endLine: 4, text: "  foo()\n", diagnostics: ["unknown foo"] }
  assert.match(codePrompt("fixCode", context), /src\/main.ts:2-4/)
  assert.match(codePrompt("fixCode", context), /  foo\(\)\n/)
  assert.match(codePrompt("fixCode", context), /unknown foo/)
  assert.doesNotMatch(codePrompt("explainCode", context), /unknown foo/)
  assert.throws(() => codePrompt("fixCode", { ...context, text: " " }))
  assert.throws(() => codePrompt("fixCode", { ...context, text: "x".repeat(24001) }))
})
it("appends without replacing existing work and rejects oversized combined drafts", () => {
  assert.equal(appendContext("my question", "code"), "my question\n\ncode")
  assert.equal(appendContext("", "code"), "code")
  assert.throws(() => appendContext("x".repeat(31999), "code"))
})
