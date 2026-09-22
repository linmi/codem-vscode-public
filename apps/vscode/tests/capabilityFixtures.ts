import { capabilityHostFixture } from "./capabilityHostFixture.ts"
import type { AppServerHostEvent } from "@codem/app-server"
import { ChatController, type ChatHost, type ChatSession } from "../src/chat/chatController.ts"
import { fixtureSpaceDirectory } from "./spaceFixtures.ts"

export function capabilityFixture() {
  let listener: (event: AppServerHostEvent) => void = () => {}
  let turn = 0
  const calls: string[] = []
  const host: ChatHost = {
    ...capabilityHostFixture(),
    async listThreads() { return { threads: [{ id: "thread-1", cwd: "/workspace", archived: false, model: "model", profile: "default", preview: "会话一", startedAt: "2026-09-20", turnCount: 1 }], nextCursor: null, total: 1 } },
    async readThread(_cwd, id) { return { id, cwd: "/workspace", archived: false, model: "model", profile: "default", startedAt: "2026-09-20", name: null, status: "idle" } },
    async resumeThread() { calls.push("resume") },
    async readModes() { return { revision: 1, permissionEpoch: 1, permissionMode: "default", workMode: "normal" } },
    async setModes(input) { return { revision: 2, permissionEpoch: 2, permissionMode: input.permissionMode ?? "default", workMode: input.workMode ?? "normal" } },
    async listTools() { return { threadId: "thread-1", model: "model", tools: [] } },
    async listBackgroundTerminals() { return { cwd: "/workspace", terminals: [] } },
    async terminateBackgroundTerminal() {}, async cleanBackgroundTerminals() { return { cwd: "/workspace", results: [] } },
    async cancelBackgroundTask() { return "cancelled" },
    onEvent(callback) { listener = callback; return () => { listener = () => {} } },
    async startThread() { calls.push("startThread"); return "thread-1" },
    async startTurn(input) { turn++; listener({ type: "turn-started", threadId: "thread-1", turnId: `turn-${turn}`, submissionId: input.submissionId }); return `turn-${turn}` },
    async interruptTurn() {}, async unsubscribeThread() {}, async respondToInteraction() {}, async close() {},
  }
  const session: ChatSession = { host, cwd: "/workspace", workspace: "project", space: { key: "testSpace", name: "测试空间" }, spaceDirectory: fixtureSpaceDirectory(), model: "model", models: [{ id: "model", source: "fixture", contextWindowTokens: 10000, supportsVision: true }], mcpServers: [], authorize: async () => { calls.push("authorize") }, searchHistory: async () => ({ hits: [], truncated: false }), readHistory: async () => ({ todoSnapshot: null, turns: [], nextCursor: null }) }
  const controller = new ChatController({ connect: async () => session, assertTrusted() {}, publish() {}, interact: async () => null, report() {} })
  const emit = (event: AppServerHostEvent) => listener(event)
  const finish = () => emit({ type: "turn-completed", threadId: "thread-1", turnId: `turn-${turn}`, outcome: "completed", stopReason: "end", error: null })
  return { controller, host, session, emit, finish, calls }
}
