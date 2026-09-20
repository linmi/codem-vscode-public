import assert from "node:assert/strict"
import { it } from "node:test"
import { TerminalOutput, terminalPrompt } from "../src/integrations/terminalContext.ts"
it("bounds each output stream and removes ANSI sequences including split chunks", () => {
  const output = new TerminalOutput(30)
  output.append("old".repeat(20)); output.append("\u001b["); output.append("31mERROR\u001b[0m")
  assert.match(output.snapshot(), /仅保留最近输出/)
  assert.match(output.snapshot(), /ERROR/)
  assert.equal(output.snapshot().includes(String.fromCharCode(27)), false)
  assert.ok(output.snapshot().length < 50)
})
it("rejects empty and oversized terminal context; repair drafts do not request immediate execution", () => {
  assert.throws(() => terminalPrompt("context", ""))
  assert.throws(() => terminalPrompt("explain", "x".repeat(24001)))
  assert.match(terminalPrompt("fix", "command failed"), /执行命令前先说明原因/)
})
