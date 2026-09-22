import assert from "node:assert/strict"
import { ChatController } from "../src/chat/chatController.ts"
import { nextEditPrompt, parseNextEdit, type NextEditContext } from "../src/integrations/nextEdit/nextEditProposal.ts"
import { liveRuntime } from "./liveRuntime.ts"
export async function runLiveNextEdit(extensionRoot: string, workspace: string): Promise<void> {
  let requests = 0, turns = 0
  const failures: string[] = []
  const controller = new ChatController({
    connect: async signal => {
      const session = await liveRuntime(extensionRoot, workspace, signal)
      session.host.onEvent(event => { if (event.type === "side-question-started") requests++; if (event.type === "turn-started") turns++ })
      return session
    },
    assertTrusted() {}, publish() {}, report(operation, error) { failures.push(`${operation}: ${String(error)}`) },
    interact: async () => { throw new Error("Next Edit must not invoke tools") },
  })
  const context: NextEditContext = { language: "typescript", firstLine: 1, source: "const displayName = 'Ada';\nconsole.log(userName);\n", cursorLine: 1, recent: { before: "userName", after: "displayName", line: 1 }, diagnostics: ["Line 2: Cannot find name 'userName'."] }
  try {
    await controller.connect(); assert.equal(controller.snapshot().phase, "ready", failures.join('\n'))
    const started = performance.now()
    const raw = await controller.generateText(nextEditPrompt(context), AbortSignal.timeout(15000), controller.contextKey())
    const proposal = parseNextEdit(raw, context, 0)
    assert.ok(proposal, 'Clear rename follow-up must yield one edit')
    const result = context.source.slice(0, proposal.start) + proposal.after + context.source.slice(proposal.end)
    assert.equal(result, "const displayName = 'Ada';\nconsole.log(displayName);\n")
    assert.equal(requests, 1); assert.equal(turns, 0); assert.deepEqual(failures, [])
    console.log(JSON.stringify({ feature: 'nextEdit', elapsedMs: Math.round(performance.now() - started), requests, turns, result: 'passed' }))
  } finally { await controller.dispose() }
}
