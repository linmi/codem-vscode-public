import type { AppServerHostEvent } from "@codem/app-server"
import { ChatController, type ChatHost, type ChatSession } from "../src/chat/chatController.ts"
import type { ChatSnapshot } from "../src/shared/messages.ts"
import { capabilityHostFixture } from "./capabilityHostFixture.ts"
import { fixturePluginCommands } from "./pluginFixtures.ts"
import { fixtureSpaceDirectory } from "./spaceFixtures.ts"

/** Mixed Chinese prose, inline code and a fenced block, roughly the size of one real reply. */
const paragraph = "CodeM 正在检查 `src/chat/chatController.ts` 的快照发布路径，并对比每次增量的成本。\n\n```ts\nconst next = { ...state, messages }\n```\n"

/**
 * A connected controller holding `messageCount` messages with one running turn.
 * `publish` sees every snapshot after setup; `stream` feeds one text delta to a fresh reply.
 */
export async function streamingConversation(messageCount: number, publish: (state: ChatSnapshot) => void = () => undefined) {
  let listener: (event: AppServerHostEvent) => void = () => undefined
  let observing = false
  const host: ChatHost = {
    ...capabilityHostFixture(),
    async listThreads() { return { threads: [], nextCursor: null, total: 0 } },
    async readThread() { throw new Error("No fixture history") },
    async resumeThread() {},
    async readModes() { return { revision: 1, permissionEpoch: 1, permissionMode: "default", workMode: "normal" } },
    async setModes() { throw new Error("Not used") },
    async listTools() { throw new Error("Not used") },
    async listBackgroundTerminals() { return { cwd: "/workspace", terminals: [] } },
    async terminateBackgroundTerminal() {}, async cleanBackgroundTerminals() { return { cwd: "/workspace", results: [] } },
    async cancelBackgroundTask() { return "cancelled" },
    onEvent(callback) { listener = callback; return () => { listener = () => undefined } },
    async startThread() { return "thread-1" },
    async startTurn(input) { listener({ type: "turn-started", threadId: "thread-1", turnId: "turn-1", submissionId: input.submissionId }); return "turn-1" },
    async interruptTurn() {}, async unsubscribeThread() {}, async respondToInteraction() {}, async close() {},
  }
  const session: ChatSession = {
    authorize: async () => {}, pluginCommands: fixturePluginCommands(), searchHistory: async () => ({ hits: [], truncated: false }),
    readHistory: async () => ({ todoSnapshot: null, turns: [], nextCursor: null }), host, cwd: "/workspace", workspace: "project",
    space: { key: "testSpace", name: "测试空间" }, spaceDirectory: fixtureSpaceDirectory(), model: "model-from-core",
    models: [{ id: "model-from-core", source: "fixture", contextWindowTokens: 10000, supportsVision: true }], mcpServers: [],
  }
  const controller = new ChatController({
    connect: async () => session, assertTrusted() {}, interact: async () => null, report() {},
    publish: state => { if (observing) publish(state) },
  })
  await controller.connect()
  await controller.send("整理快照发布路径")
  for (let index = 1; index < messageCount; index++) {
    const event = index % 3 === 0 ? "reasoning-delta" : "text-delta"
    listener({ type: event, threadId: "thread-1", turnId: "turn-1", itemId: `item-${index}`, delta: paragraph.repeat(4 + (index % 4) * 4) })
  }
  observing = true
  return {
    controller,
    stream(delta: string) { listener({ type: "text-delta", threadId: "thread-1", turnId: "turn-1", itemId: "streaming", delta }) },
    emit(event: AppServerHostEvent) { listener(event) },
  }
}
