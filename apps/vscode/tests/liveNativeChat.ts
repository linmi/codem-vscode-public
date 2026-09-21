import assert from "node:assert/strict"
import type { ChatSession } from "../src/chat/chatController.ts"
import { NativeChatService } from "../src/nativeChat/nativeChatService.ts"
import { liveRuntime } from "./liveRuntime.ts"

/** Explicit test:live acceptance of the native adapter, with a disposable workspace. */
export async function runLiveNativeChat(extensionRoot: string, workspace: string): Promise<void> {
  let session: ChatSession | undefined
  let connections = 0
  const events: string[] = []
  const created = new Set<string>()
  const stages: Record<string, number> = {}
  const create = () => new NativeChatService({
    assertTrusted() {},
    connect: async (signal) => {
      session = await liveRuntime(extensionRoot, workspace, signal)
      connections++
      session.host.onEvent(event => { events.push(event.type); if (event.type === "thread-started") created.add(event.threadId) })
      return session
    },
    interact: async request => { throw new Error(`Unexpected native fixture interaction: ${request.kind}`) },
    report: operation => console.log(`NATIVE_OPERATION_FAILED ${operation}`),
  }, () => {})
  let agent = create()
  const signal = () => AbortSignal.timeout(90_000)
  async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try { return await run() }
    finally { stages[label] = Math.round(performance.now() - start); console.log(`NATIVE_STAGE ${label} ${stages[label]}ms`) }
  }
  async function send(id: string, prompt: string): Promise<string> {
    let answer = ""
    await agent.run(id, prompt, { text: text => { answer += text }, progress() {} }, signal())
    assert.equal(agent.snapshot().phase, "ready")
    assert.equal(agent.snapshot().notice, null)
    return answer
  }
  try {
    const id = await timed("create", () => agent.create(signal()))
    created.add(id)
    assert.match(await timed("first", () => send(id, "这是界面验收。不要使用工具，不要访问任何文件。只回复 CODEM_NATIVE_OK。")), /CODEM_NATIVE_OK/)
    assert.match(await timed("followup", () => send(id, "不要使用工具。只重复你上一条回复中的英文标记。")), /CODEM_NATIVE_OK/)
    assert.equal(connections, 1, "Repeated prompts must reuse the same connection")
    assert.equal(events.filter(event => event === "turn-completed").length, 2)
    const stop = new AbortController()
    const deadline = setTimeout(() => stop.abort(), 30_000)
    try {
      await timed("stop", () => agent.run(id, "这是停止生成验收。不要使用工具，不要访问文件。请写一篇两千字的 TypeScript 类型系统介绍。", {
        text: text => { if (text) stop.abort() },
        progress: () => stop.abort(),
      }, stop.signal))
      assert.equal(stop.signal.aborted, true)
      assert.equal(agent.snapshot().notice, null)
      assert.equal(agent.snapshot().messages.at(-1)?.role, "turnStatus")
      assert.equal(events.filter(event => event === "turn-completed").length, 3)
    } finally { clearTimeout(deadline) }
    await agent.dispose()
    agent = create()
    const history = await timed("restore", () => agent.history(id, signal()))
    assert.equal(history.filter(message => message.role === "user").length, 3)
    assert.equal(history.filter(message => message.role === "assistant" && message.text.includes("CODEM_NATIVE_OK")).length, 2)
    assert.equal(connections, 2)
    console.log(`CODEM_LIVE_NATIVE_CHAT_OK ${JSON.stringify({ stages, connections })}`)
  } finally {
    // Only identities created by this fixture, never pre-existing user sessions.
    try { for (const threadId of created) if (session) await session.host.control(session.cwd, "thread/delete", { threadId }) }
    finally { await agent.dispose() }
  }
}
