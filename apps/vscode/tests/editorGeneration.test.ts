import assert from "node:assert/strict"
import { it } from "node:test"
import { completionPrompt, commitPrompt, generatedText } from "../src/editorGeneration.ts"
it("bounds completion context and preserves insertion whitespace", () => {
  const prompt = completionPrompt("typescript", "x".repeat(10000), "y".repeat(10000))
  assert.ok(prompt.length < 13000)
  assert.equal(generatedText('{"insertText":"  foo()\\n"}', "insertText"), "  foo()\n")
  assert.throws(() => generatedText("Here is code", "insertText"))
  assert.throws(() => generatedText('{"message":"wrong kind"}', "insertText"))
  assert.throws(() => generatedText(JSON.stringify({ insertText: String.fromCharCode(0) }), "insertText"))
})
it("commit generation refuses missing or truncated input and validates output", () => {
  assert.throws(() => commitPrompt(" "))
  assert.throws(() => commitPrompt("x".repeat(24001)))
  assert.match(commitPrompt("+feature"), /\+feature/)
  assert.equal(generatedText('{"message":" fix issue \\n"}', "message"), "fix issue")
  assert.throws(() => generatedText('{"message":""}', "message"))
  assert.throws(() => generatedText(JSON.stringify({ message: "x".repeat(4001) }), "message"))
})
