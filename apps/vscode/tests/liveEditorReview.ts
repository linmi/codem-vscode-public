import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { ChatController } from "../src/chat/chatController.ts"
import { EditProposal, editPrompt } from "../src/integrations/editProposal.ts"
import { liveRuntime } from "./liveRuntime.ts"

export async function runLiveEditorReview(extensionRoot: string, workspace: string): Promise<void> {
  const failures: string[] = []
  let requests = 0, turns = 0
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
    interact: async () => { throw new Error("Editor suggestions must not request tool permissions") },
  })
  try {
    await controller.connect()
    assert.equal(controller.snapshot().phase, "ready", failures.join("\n"))
    const original = await readFile(new URL("./fixtures/editorReviewSample.txt", import.meta.url), "utf8")
    const started = performance.now()
    const raw = await controller.generateText(editPrompt("fixCode", "typescript", original, "", "", []), AbortSignal.timeout(60000), controller.contextKey())
    const proposal = new EditProposal(original, 0, original.length, raw)
    assert.equal(proposal.pending.length, 2, "Independent arithmetic bugs must be independently reviewable")
    assert.equal(proposal.source(), original)
    assert.match(proposal.preview(), /function add[\s\S]*return a \+ b/)
    assert.match(proposal.preview(), /function multiply[\s\S]*return a \* b/)
    const [first, second] = proposal.pending
    proposal.choose([first!.id], "accepted"); proposal.choose([second!.id], "rejected")
    assert.match(proposal.source(), /function multiply[\s\S]*return a \+ b/)
    assert.equal(requests, 1); assert.equal(turns, 0); assert.deepEqual(failures, [])
    console.log(`CODEM_LIVE_EDITOR_REVIEW_OK ${JSON.stringify({ elapsedMs: Math.round(performance.now() - started), requests, turns, blocks: proposal.edits.length })}`)
  } finally { await controller.dispose() }
}
