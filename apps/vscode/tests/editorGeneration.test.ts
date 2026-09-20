import assert from "node:assert/strict"
import { it } from "node:test"
import { completionPrompt, generatedText } from "../src/integrations/editorGeneration.ts"
it("bounds completion context and preserves insertion whitespace", () => {
  const prompt = completionPrompt("typescript", "x".repeat(10000), "y".repeat(10000))
  assert.ok(prompt.length < 13000)
  assert.equal(generatedText('{"insertText":"  foo()\\n"}', "insertText"), "  foo()\n")
  assert.throws(() => generatedText("Here is code", "insertText"))
  assert.throws(() => generatedText('{"message":"wrong kind"}', "insertText"))
  assert.throws(() => generatedText(JSON.stringify({ insertText: String.fromCharCode(0) }), "insertText"))
})
