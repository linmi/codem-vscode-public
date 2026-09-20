import assert from "node:assert/strict"
import { it } from "node:test"
import { generatedText } from "../src/integrations/editorGeneration.ts"
it("commit message parsing rejects invalid or empty output", () => {
  assert.equal(generatedText('{"message":"  fix: retry  "}', "message"), "fix: retry")
  assert.throws(() => generatedText("Here is code", "message"))
  assert.throws(() => generatedText('{"insertText":"wrong kind"}', "message"))
  assert.throws(() => generatedText('{"message":""}', "message"))
})
