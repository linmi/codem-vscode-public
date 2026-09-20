import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"
import { ChatController } from "../src/chat/chatController.ts"
import { PanelBroker } from "../src/panels/panelBroker.ts"
import { showInteraction } from "../src/panels/interactions.ts"
import { liveRuntime } from "./liveRuntime.ts"

/** Explicit test:live --headless only; exercises the real Core without opening VS Code. */
export async function runLiveConnection(extensionRoot: string, workspace: string): Promise<void> {
  const failures: string[] = []
  const trace: object[] = []
  const observedTextTurns = new Set<string>()
  const panels = new PanelBroker(), owner = {}
  let mode: "text" | "question" | "cancel" | "stop" = "text"
  let questions = 0, activities = 0, turns = 0, connections = 0
  let outcome: string | null = null
  let panelVisible = false
  const stages: { stage: string; elapsedMs: number }[] = []
  panels.bind(owner, ({ panel }) => {
    panelVisible = panel !== null
    if (!panel) return
    assert.equal(panel.kind, "question")
    assert.ok(panel.choices[0])
    panels.answer(owner, { type: "panelReply", id: panel.id, choiceIds: mode === "cancel" ? [] : [panel.choices[0].id], text: "", cancelled: mode === "cancel" })
  })
  const controller = new ChatController({
    connect: async (signal) => {
      connections++
      const session = await liveRuntime(extensionRoot, workspace, signal)
      session.host.onEvent(event => {
        if (event.type === "turn-started" || event.type === "turn-completed" || (event.type === "text-delta" && !observedTextTurns.has(event.turnId))) {
          trace.push({ type: event.type, turnId: event.turnId, outcome: "outcome" in event ? event.outcome : null, at: Date.now() })
          if (event.type === "text-delta") observedTextTurns.add(event.turnId)
        }
        if (event.type === "protocol-error") failures.push(event.message)
        if (event.type === "connection-closed" && !event.exit.expected) failures.push(`Core exit: ${JSON.stringify(event.exit)}`)
        if (event.type === "turn-activity") activities++
        if (event.type === "turn-started") turns++
        if (event.type === "turn-completed") outcome = event.outcome
      })
      return session
    },
    assertTrusted() {}, publish() {},
    report(operation, error) { failures.push(`${operation}: ${String(error)}`) },
    interact: async (request, signal, cwd) => {
      assert.ok(mode === "question" || mode === "cancel")
      assert.equal(request.kind, "question")
      questions++
      return showInteraction(request, signal, panels, cwd)
    },
  })
  async function settled(): Promise<void> {
    const deadline = Date.now() + 60000
    while (!["ready", "disconnected"].includes(controller.snapshot().phase) && Date.now() < deadline) await delay(50)
    assert.equal(controller.snapshot().phase, "ready", failures.join("\n"))
    assert.equal(panelVisible, false)
    assert.notEqual(controller.snapshot().turnTimings.at(-1)?.finishedAt, null)
  }
  async function turn(stage: string, prompt: string, marker: string): Promise<void> {
    const started = performance.now()
    const previousCount = controller.snapshot().messages.length
    outcome = null
    assert.equal(await controller.send(prompt), true)
    await settled()
    assert.equal(outcome, "completed")
    assert.ok(controller.snapshot().messages.slice(previousCount).some(message => message.role === "assistant" && message.text.includes(marker)), `Missing ${marker}; trace=${JSON.stringify(trace)}; stages=${JSON.stringify(stages)}`)
    stages.push({ stage, elapsedMs: Math.round(performance.now() - started) })
  }
  try {
    const connecting = performance.now()
    await controller.connect()
    assert.equal(controller.snapshot().phase, "ready", failures.join("\n"))
    stages.push({ stage: "connect", elapsedMs: Math.round(performance.now() - connecting) })
    await turn("text", "这是客户端联调测试。只回复 CODEM_CONNECTION_OK，不要调用工具，不要读取或修改任何文件。", "CODEM_CONNECTION_OK")
    const threadId = controller.snapshot().threadId
    mode = "question"
    await turn("question", "客户端提问验收：只调用一次 ask_user，提一个问题，两个选项 A 和 B。收到回答后只回复 CODEM_QUESTION_OK。不要读取、修改文件或执行命令。", "CODEM_QUESTION_OK")
    assert.equal(questions, 1)
    mode = "cancel"
    await turn("cancel-question", "客户端取消验收：只调用一次 ask_user，提一个问题，两个选项 A 和 B。用户取消后只回复 CODEM_CANCEL_OK 并结束，不要再提问，不要读取、修改文件或执行命令。", "CODEM_CANCEL_OK")
    assert.equal(questions, 2)
    mode = "stop"
    outcome = null
    const stopping = performance.now()
    assert.equal(await controller.send("请用纯文本从 1 数到 10000，不要调用工具、读取或修改任何文件。"), true)
    await controller.stop()
    await settled()
    assert.equal(outcome, "stopped")
    stages.push({ stage: "interrupt", elapsedMs: Math.round(performance.now() - stopping) })
    mode = "text"
    await turn("after-stop", "只回复 CODEM_RESUMED_OK。不要调用工具、读取或修改任何文件。", "CODEM_RESUMED_OK")
    assert.equal(controller.snapshot().threadId, threadId)
    assert.equal(connections, 1)
    assert.equal(turns, 5)
    assert.ok(activities > 0, "The real Core must exercise turn/activity")
    assert.deepEqual(failures, [])
    console.log(`CODEM_LIVE_CONNECTION_OK ${JSON.stringify({ connections, turns, questions, activities, stages })}`)
  } finally { panels.cancel(); await controller.dispose() }
}
