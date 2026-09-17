import { historyTurn } from "./fixtures/history.ts"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ExtensionMessage } from "../../../../webview-ui/src/types/messages/extension-messages"
import {
  MatureUiAppServerController,
  type MatureUiAppServerPort,
} from "../../../../src/services/app-server/mature-ui-controller.ts"

describe("MatureUi control-plane commands", () => {
  it("rewinds, archives, unarchives, and clears via CodeM messages", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    await fixture.controller.handle({ type: "rewindThread", sessionID: "thread-1", requestID: "rewind-1" })
    assert.deepEqual(fixture.calls.rewind, [{ cwd: "/workspace", threadId: "thread-1" }])
    assert.deepEqual(fixture.messages.at(-1), {
      type: "rewindThreadResult",
      sessionID: "thread-1",
      requestID: "rewind-1",
      result: { turnId: "turn-rewind" },
    })

    await fixture.controller.handle({ type: "archiveThread", sessionID: "thread-1", requestID: "archive-1" })
    assert.equal(fixture.messages.some((message) => message.type === "sessionUpdated" && message.session.archived), true)
    assert.deepEqual(fixture.messages.at(-1), {
      type: "archiveThreadResult",
      sessionID: "thread-1",
      requestID: "archive-1",
      result: { archived: true },
    })

    await fixture.controller.handle({ type: "unarchiveThread", sessionID: "thread-1", requestID: "unarchive-1" })
    assert.deepEqual(fixture.messages.at(-1), {
      type: "unarchiveThreadResult",
      sessionID: "thread-1",
      requestID: "unarchive-1",
      result: { archived: false },
    })

    await fixture.controller.handle({ type: "createSession" })
    await fixture.controller.handle({ type: "clearThread", sessionID: "thread-1", requestID: "clear-1" })
    assert.deepEqual(fixture.calls.clear, [{ cwd: "/workspace", threadId: "thread-1", operationId: "clear-1" }])
    assert.deepEqual(fixture.messages.at(-1), {
      type: "clearThreadResult",
      sessionID: "thread-1",
      requestID: "clear-1",
      result: { cleared: true },
    })
    assert.equal(await fixture.controller.handle({ type: "clearSession" }), false)
  })

  it("copies only the environment, config, plugin, and terminal whitelist", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "requestEnvironmentInfo", requestID: "env-1" })
    const environment = fixture.messages.at(-1)
    assert.deepEqual(environment, {
      type: "environmentInfoLoaded",
      requestID: "env-1",
      result: { agentName: "codem", agentVersion: "0.8.37", os: "macos", arch: "arm64" },
    })
    assert.equal(environment && "cwd" in (environment as { result: object }).result, false)

    await fixture.controller.handle({ type: "requestConfigSnapshot", requestID: "cfg-1" })
    assert.deepEqual(fixture.messages.at(-1), {
      type: "configSnapshotLoaded",
      requestID: "cfg-1",
      result: { writable: false, writeOwner: "core", config: { theme: "dark" } },
    })
    assert.equal(await fixture.controller.handle({ type: "requestConfig" }), false)

    await fixture.controller.handle({ type: "requestPlugins", requestID: "plug-1" })
    assert.deepEqual(fixture.messages.at(-1), {
      type: "pluginsLoaded",
      requestID: "plug-1",
      result: { installed: ["review"], marketplaces: ["official"] },
    })

    await fixture.controller.handle({ type: "createSession" })
    await fixture.controller.handle({ type: "requestBackgroundTerminals", sessionID: "thread-1", requestID: "term-1" })
    assert.deepEqual(fixture.messages.at(-1), {
      type: "backgroundTerminalsLoaded",
      sessionID: "thread-1",
      requestID: "term-1",
      result: { terminals: [{ processId: 9, inProgress: true }] },
    })
  })

  it("fail-closes shell and terminal control without a loaded thread", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({
      type: "runShellCommand",
      sessionID: "thread-1",
      requestID: "sh-1",
      command: "echo hi",
    })
    assert.deepEqual(fixture.messages.at(-1), {
      type: "runShellCommandResult",
      sessionID: "thread-1",
      requestID: "sh-1",
      result: { error: "CodeM thread thread-1 is not loaded in this editor" },
    })
    assert.deepEqual(fixture.calls.shell, [])

    await fixture.controller.handle({
      type: "terminateBackgroundTerminal",
      sessionID: "thread-1",
      requestID: "term-2",
      processId: 9,
    })
    assert.equal(
      fixture.messages.at(-1)?.type === "terminateBackgroundTerminalResult" &&
        "error" in (fixture.messages.at(-1) as { result: { error?: string } }).result,
      true,
    )
  })

  it("cancels an enhance side question by the original requestId", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    const enhance = fixture.controller.handle({ type: "enhancePrompt", text: "Make this clearer", requestId: "enhance-1" })
    await fixture.controller.handle({ type: "cancelSideQuestion", sessionID: "thread-1", requestID: "enhance-1" })
    await enhance
    assert.deepEqual(fixture.calls.cancelSide, [{ cwd: "/workspace", threadId: "thread-1", sideQuestionId: "side-1" }])
    assert.deepEqual(fixture.messages.at(-1), {
      type: "cancelSideQuestionResult",
      sessionID: "thread-1",
      requestID: "enhance-1",
      result: { cancelled: true },
    })
  })
})

function createFixture() {
  const messages: ExtensionMessage[] = []
  const calls = {
    rewind: [] as Record<string, unknown>[],
    clear: [] as Record<string, unknown>[],
    shell: [] as Record<string, unknown>[],
    cancelSide: [] as Record<string, unknown>[],
  }
  const thread = {
    id: "thread-1",
    cwd: "/workspace",
    archived: false,
    model: "codem-router/auto",
    profile: "default",
    preview: "Build it",
    startedAt: "2026-09-15T00:00:00.000Z",
    turnCount: 1,
  } as const
  const service: MatureUiAppServerPort = {
    readModes: async () => ({ revision: 0, permissionEpoch: 0, permissionMode: "default", workMode: "normal" }),
    setModes: async () => ({ revision: 1, permissionEpoch: 1, permissionMode: "auto", workMode: "normal" }),
    startThread: async () => thread.id,
    resumeThread: async () => undefined,
    listThreads: async () => ({ threads: [thread], nextCursor: null, total: 1 }),
    readHistory: async () => ({ turns: [historyTurn()], nextCursor: null }),
    listModels: async () => ({ activeModel: thread.model, models: [] }),
    startTurn: async () => "turn-1",
    steerTurn: async () => undefined,
    interrupt: async () => undefined,
    compactThread: async () => "turn-compact",
    cancelBackgroundTask: async () => "cancelled",
    startSideQuestion: async () => "side-1",
    renameThread: async () => undefined,
    deleteThread: async () => undefined,
    forkThread: async () => thread.id,
    listSkills: async () => [],
    listPermissionProfiles: async () => [
      { id: "default", name: "Default", description: "", settableAtRuntime: true },
      { id: "auto", name: "Auto", description: "", settableAtRuntime: true },
      { id: "yolo", name: "Yolo", description: "", settableAtRuntime: true },
    ],
    rewindThread: async (cwd, threadId) => {
      calls.rewind.push({ cwd, threadId })
      return "turn-rewind"
    },
    archiveThread: async () => undefined,
    unarchiveThread: async () => undefined,
    clearThread: async (cwd, threadId, operationId) => {
      calls.clear.push({ cwd, threadId, operationId })
    },
    listLoadedThreadIds: async () => ({ threadIds: [thread.id] }),
    listHooks: async () => ({ cwd: "/workspace", hooks: { SessionStart: [{ command: "/tmp/check.sh", matcher: null }] } }),
    listPlugins: async () => ({
      installed: { review: { path: "/tmp/plugin" } },
      marketplaces: { official: { url: "https://example.test" } },
    }),
    listTools: async () => ({ threadId: thread.id, model: thread.model, tools: ["bash"] }),
    readEnvironmentInfo: async () => ({
      agentName: "codem",
      agentVersion: "0.8.37",
      arch: "arm64",
      cwd: "/workspace",
      os: "macos",
      shell: "/bin/zsh",
    }),
    readConfigSnapshot: async () => ({
      writable: false,
      writeOwner: "core",
      config: { theme: "dark", cwd: "/workspace" },
    }),
    readModelProviderCapabilities: async () => ({ version: "v1", askUser: { ask: true }, custom: {} }),
    listBackgroundTerminals: async () => ({
      cwd: "/workspace",
      terminals: [{ processId: 9, logPath: "/tmp/term.log", inProgress: true }],
    }),
    terminateBackgroundTerminal: async () => undefined,
    cleanBackgroundTerminals: async () => ({ cwd: "/workspace", results: [{ processId: 9 }] }),
    runShellCommand: async (cwd, threadId, command) => {
      calls.shell.push({ cwd, threadId, command })
    },
    cancelSideQuestion: async (cwd, threadId, sideQuestionId) => {
      calls.cancelSide.push({ cwd, threadId, sideQuestionId })
    },
    respondToInteraction: async () => undefined,
  }
  const controller = new MatureUiAppServerController({
    service,
    cwdForThread: () => "/workspace",
    preparePrompt: async (message) => ({ text: message.text, attachments: [] }),
    post: (message) => messages.push(message),
    selectThread: () => undefined,
  })
  return { controller, messages, calls, service }
}
