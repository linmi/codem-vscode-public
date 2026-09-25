import assert from "node:assert/strict"
import { createBundledAppServerRuntimeResolver } from "@codem/app-server"
import { ChatController } from "../src/chat/chatController.ts"
import { assertTrusted, connectRuntime } from "../src/connection/runtimeSession.ts"
import type { ChatSnapshot } from "../src/shared/messages.ts"

/** Opt-in only: uses the real credential broker/Core and consumes a model turn. */
export async function runLiveChat(extensionRoot: string): Promise<void> {
  let deltaCount = 0
  let terminalOutcome: string | null = null
  let finish: (state: ChatSnapshot) => void = () => undefined
  const completed = new Promise<ChatSnapshot>((resolve) => { finish = resolve })
  const runtime = createBundledAppServerRuntimeResolver({ extensionRoot })
  const controller = new ChatController({
    connect: async (signal) => {
      const session = await connectRuntime(runtime, "0.2.0", signal)
      session.host.onEvent((event) => {
        if (event.type === "text-delta") deltaCount++
        if (event.type === "turn-completed") terminalOutcome = event.outcome
      })
      return session
    },
    assertTrusted,
    publish: (state) => {
      if (state.messages.length && (state.phase === "ready" || state.phase === "disconnected")) finish(state)
    },
    interact: async () => { throw new Error("Text-only live test unexpectedly requested user approval") },
    report: (operation) => console.log(`CodeM live test failure at ${operation}`),
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await controller.connect()
    assert.equal(controller.snapshot().phase, "ready", controller.snapshot().notice ?? "Runtime connection failed")
    assert.equal(await controller.send("这是客户端联调测试。只回复 CODEM_REAL_OK，不要调用工具，不要读取或修改任何文件。"), true, "Core must acknowledge the submission")
    const state = await Promise.race([completed, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Live chat exceeded 60 seconds")), 60_000) })])
    assert.equal(terminalOutcome, "completed")
    assert.equal(state.phase, "ready")
    assert.ok(state.messages.some((message) => message.role === "assistant" && message.text.includes("CODEM_REAL_OK")), "Expected real model response")
    assert.ok(deltaCount > 0, "Expected real streamed text deltas")
    console.log(`CODEM_LIVE_CHAT_OK: ${deltaCount} streamed deltas, Core completed, UI returned to ready`)
  } finally {
    clearTimeout(timer)
    await controller.dispose()
  }
}
