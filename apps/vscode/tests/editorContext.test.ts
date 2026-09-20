import assert from "node:assert/strict"
import { it } from "node:test"
import { appendContext, codePrompt, codePromptParts, type EditorAction } from "../src/shared/editorContext.ts"
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
it("renders persisted selected code separately without changing whitespace or user instructions", () => {
  const context = { path: "src/accountController.ts", language: "typescript", startLine: 17, endLine: 19, text: "  constructor() {\n    this.value = '<img src=x onerror=alert(1)>'\n  }\n", diagnostics: ["unknown property"] }
  for (const action of ["addToContext", "explainCode", "fixCode", "improveCode"] satisfies EditorAction[]) {
    const prompt = codePrompt(action, context)
    const parts = codePromptParts(appendContext("这行代码写了什么？", prompt))
    assert.equal(parts[0]?.text, "这行代码写了什么？")
    assert.deepEqual(parts.find(part => part.kind === "code"), { kind: "code", path: context.path, language: context.language, startLine: 17, endLine: 19, text: context.text })
    if (action === "addToContext") assert.equal(parts.length, 2)
    else assert.equal(parts[1]?.text, prompt.split("\n")[0])
    if (action === "fixCode") assert.equal(parts.at(-1)?.text, "\n诊断：\nunknown property")
  }
})
it("supports repeated code contexts and a single line while preserving following text", () => {
  const context = { path: "C:\\src\\main.ts", language: "custom-language", startLine: 7, endLine: 7, text: "x()", diagnostics: [] }
  const prompt = codePrompt("addToContext", context)
  const parts = codePromptParts(appendContext(appendContext(prompt, prompt), "保留这段补充说明"))
  assert.deepEqual(parts.map(part => part.kind), ["code", "code", "text"])
  assert.equal(parts[0]?.kind === "code" && parts[0].path, context.path)
  assert.equal(parts.at(-1)?.text, "\n\n保留这段补充说明")
})
it("keeps ordinary markup, incomplete envelopes and invalid ranges literal", () => {
  const prompt = codePrompt("addToContext", { path: "src/main.ts", language: "typescript", startLine: 2, endLine: 4, text: "x()", diagnostics: [] })
  for (const text of ["<selected_code>\nx()\n</selected_code>", "<b>ordinary user text</b>", prompt.replace("</selected_code>", ""), prompt.replace("2-4", "4-2"), prompt.replace("2-4", "0-4"), prompt.replace("2-4", "2-999999999999999999999"), `普通引用：\n${prompt}`]) {
    assert.deepEqual(codePromptParts(text), [{ kind: "text", text }])
  }
})
