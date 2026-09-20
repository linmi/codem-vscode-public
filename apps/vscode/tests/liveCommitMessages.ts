import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { ChatController } from "../src/chat/chatController.ts"
import { commitPrompt, commitMessage } from "../src/integrations/commitMessage.ts"
import { liveRuntime } from "./liveRuntime.ts"

/** Explicit test:live --commit-messages only. Historical patches are data; never touch the real index. */
export async function runLiveCommitMessages(extensionRoot: string, workspace: string): Promise<void> {
  const failures: string[] = []
  let connections = 0, questions = 0, turns = 0
  const controller = new ChatController({
    connect: async signal => {
      connections++
      const session = await liveRuntime(extensionRoot, workspace, signal)
      session.host.onEvent(event => {
        if (event.type === "side-question-started") questions++
        if (event.type === "turn-started") turns++
        if (event.type === "protocol-error") failures.push(event.message)
      })
      return session
    },
    assertTrusted() {}, publish() {},
    report(operation, error) { failures.push(`${operation}: ${String(error)}`) },
    interact: async () => { throw new Error("Commit generation must not require an interaction") },
  })
  const cases = [
    { name: "avatar", subjects: ["Show account information", "Preserve chat drafts", "Add terminal context"], language: "zh-cn", expected: /avatar|photo|picture/i },
    { name: "selections", subjects: ["feat(chat): 添加终端上下文", "fix(chat): 保留发送失败的草稿", "feat(chat): 显示账户信息"], language: "en", expected: /选区|引用|代码/ },
    { name: "docs", subjects: [], language: "zh-cn", expected: /文档|说明|README/i },
  ]
  try {
    const connecting = performance.now()
    await controller.connect()
    assert.equal(controller.snapshot().phase, "ready", failures.join("\n"))
    console.log(`COMMIT_CONNECT ${Math.round(performance.now() - connecting)}ms`)
    for (const sample of cases) {
      const fixture: { diff: string[] } = JSON.parse(await readFile(new URL(`./fixtures/commitMessages/${sample.name}.json`, import.meta.url), "utf8"))
      const diff = fixture.diff.join("")
      const started = performance.now()
      const raw = await controller.generateText(commitPrompt(diff, sample.subjects, sample.language), AbortSignal.timeout(60000), controller.contextKey())
      const message = commitMessage(raw)
      assert.match(message, sample.expected)
      assert.doesNotMatch(message, /tests? pass|测试通过|测试已通过/i)
      if (sample.name === "avatar") assert.doesNotMatch(message, /[\u4e00-\u9fff]/)
      if (sample.name === "selections") {
        assert.match(message, /^feat(?:\([a-z]+\))?: .*?[\u4e00-\u9fff]/)
        assert.doesNotMatch(message, /SelectedCodeState|matchingIds|pin\/remove\/consume|按引用消费/)
      }
      console.log(`COMMIT_SAMPLE ${JSON.stringify({ name: sample.name, elapsedMs: Math.round(performance.now() - started), message })}`)
    }
    assert.equal(connections, 1); assert.equal(questions, cases.length); assert.equal(turns, 0)
    assert.deepEqual(failures, [])
    console.log(`CODEM_LIVE_COMMIT_OK ${JSON.stringify({ connections, questions, turns })}`)
  } catch (error) {
    console.error(`COMMIT_FAILURE ${JSON.stringify(failures)}`)
    throw error
  } finally { await controller.dispose() }
}
