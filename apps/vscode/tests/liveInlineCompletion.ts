import assert from "node:assert/strict"
import { ChatController } from "../src/chat/chatController.ts"
import { completionPrompt, generatedText } from "../src/integrations/editorGeneration.ts"
import { liveRuntime } from "./liveRuntime.ts"

export async function runLiveInlineCompletion(extensionRoot: string, workspace: string): Promise<void> {
  let requests = 0, turns = 0
  const failures: string[] = []
  const controller = new ChatController({
    connect: async signal => {
      const session = await liveRuntime(extensionRoot, workspace, signal)
      session.host.onEvent(event => {
        if (event.type === "side-question-started") requests++
        if (event.type === "turn-started") turns++
        if (event.type === "protocol-error") failures.push(event.message)
      })
      return session
    },
    assertTrusted() {}, publish() {}, report(operation, error) { failures.push(`${operation}: ${String(error)}`) },
    interact: async () => { throw new Error("Inline completion must not request tool permissions") },
  })
  try {
    await controller.connect()
    assert.equal(controller.snapshot().phase, "ready", failures.join("\n"))
    const started = performance.now()
    const raw = await controller.generateText(completionPrompt("typescript", "// Return the sum of a and b.\nexport function add(a: number, b: number): number {\n  return ", "\n}\n"), AbortSignal.timeout(60000), controller.contextKey())
    assert.match(generatedText(raw, "insertText"), /a\s*\+\s*b/)
    assert.equal(controller.snapshot().phase, "ready")
    assert.equal(requests, 1); assert.equal(turns, 0); assert.deepEqual(failures, [])
    console.log(`CODEM_LIVE_COMPLETION_OK ${JSON.stringify({ elapsedMs: Math.round(performance.now() - started), requests, turns })}`)
  } finally { await controller.dispose() }
}
