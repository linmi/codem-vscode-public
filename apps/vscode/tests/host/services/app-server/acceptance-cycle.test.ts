import { writeSchema13HitlSession } from "./fixtures/schema13.ts"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import type { AppServerInteraction } from "@codem/app-server"
import { AppServerMatureUiAdapter } from "../../../../src/services/app-server/mature-ui-adapter.ts"
import {
  MatureUiAppServerController,
  type MatureUiAppServerPort,
} from "../../../../src/services/app-server/mature-ui-controller.ts"
import type { ExtensionMessage } from "../../../../webview-ui/src/types/messages/extension-messages"

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe("App Server host acceptance cycle", () => {
  it("routes handleAppServerMessage before Kilo and never starts kilo serve", async () => {
    const source = await readFile(new URL("../../../../src/CodeMProvider.ts", import.meta.url), "utf8")
    const appServer = source.indexOf("if (await this.handleAppServerMessage(message)) return")
    const kiloRoute = source.indexOf("routeEarlyMessage(message,")
    assert.ok(appServer > 0 && appServer < kiloRoute, "App Server must claim Webview commands before Kilo routing")
    assert.match(source, /App Server is the only live transport/)
    assert.equal(source.includes("this.connectionService.connect("), false)
    assert.match(source, /app-server-control used to fall through to Kilo; that leak is closed/)
  })

  it("completes one sendMessage turn and one permission HITL, then reloads JSONL schema 13", async () => {
    const live = createFixture()
    await live.controller.handle({
      type: "sendMessage",
      messageID: "submission-hitl",
      text: "Create hitl-ok.txt containing exactly HITL_OK.",
      providerID: "codem-router",
      modelID: "auto",
      variant: "medium",
      permissionMode: "default",
    })
    assert.deepEqual(live.calls.startThread, [
      { cwd: "/workspace", model: "codem-router/auto", intelligence: "medium", permissionMode: "default" },
    ])
    assert.deepEqual(live.calls.startTurn, [
      {
        cwd: "/workspace",
        threadId: "thread-1",
        submissionId: "submission-hitl",
        text: "Create hitl-ok.txt containing exactly HITL_OK.",
        attachments: [],
      },
    ])

    live.controller.acceptEvent({
      type: "turn-started",
      threadId: "thread-1",
      turnId: "turn-1",
      submissionId: "submission-hitl",
    })
    live.controller.acceptEvent({
      type: "text-delta",
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "answer-1",
      delta: "DONE",
    })
    live.controller.acceptEvent({ type: "interaction", interaction: permissionInteraction() })
    assert.ok(live.messages.some((message) => message.type === "permissionRequest"))

    await live.controller.handle({
      type: "permissionResponse",
      permissionId: "permission-1",
      sessionID: "thread-1",
      response: "once",
      approvedAlways: [],
      deniedAlways: [],
    })
    assert.deepEqual(live.calls.responses, [
      { requestId: "permission-1", response: { kind: "permission", optionId: "allow_once" } },
    ])
    live.controller.acceptEvent({
      type: "interaction-resolved",
      threadId: "thread-1",
      turnId: "turn-1",
      requestId: "permission-1",
      status: "answered",
      error: null,
    })
    live.controller.acceptEvent({
      type: "turn-completed",
      threadId: "thread-1",
      turnId: "turn-1",
      outcome: "completed",
      stopReason: "end_turn",
      error: null,
    })
    assert.ok(live.messages.some((message) => message.type === "sessionTurnClosed" && message.reason === "completed"))
    assertNoKiloCatalog(live.messages)

    const sessionsRoot = await mkdtemp(join(tmpdir(), "codem-accept-"))
    temporaryRoots.push(sessionsRoot)
    const history = await writeSchema13HitlSession({
      sessionsRoot,
      cwd: sessionsRoot,
      threadId: "thread-1",
    })
    assert.equal(history.turns.length, 1)
    assert.equal(history.turns[0]?.submissionId, "submission-hitl")
    assert.equal(history.turns[0]?.turn.state, "completed")

    // reload / 重启：新 controller 只读 JSONL，不回放 live 帧，也不走 thread/turns/list。
    const reloaded = createFixture()
    reloaded.service.readHistory = async () => history
    await reloaded.controller.handle({ type: "loadMessages", sessionID: "thread-1", mode: "replace" })
    const loaded = reloaded.messages.findLast((message) => message.type === "messagesLoaded")
    assert.ok(loaded?.type === "messagesLoaded")
    assert.equal(loaded.sessionID, "thread-1")
    assert.equal(loaded.mode, "replace")
    assert.deepEqual(
      loaded.messages.map((message) => message.role),
      ["user", "assistant"],
    )
    assert.equal(loaded.messages[0]?.content, "Create hitl-ok.txt containing exactly HITL_OK.")
    assert.ok(loaded.messages[1]?.parts?.some((part) => part.type === "text" && part.text === "DONE"))
    assert.ok(
      loaded.messages[1]?.parts?.some(
        (part) => part.type === "tool" && part.tool === "write" && part.state.status === "completed",
      ),
    )
    assert.deepEqual(
      loaded,
      new AppServerMatureUiAdapter().messagesLoaded({
        threadId: "thread-1",
        turns: history.turns,
        mode: "replace",
        hasMore: false,
      }),
    )
    assertNoKiloCatalog(reloaded.messages)
  })

  it("rejects HITL answers and ignores duplicate, stale, and cross-thread events", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    fixture.controller.acceptEvent({
      type: "turn-started",
      threadId: "thread-1",
      turnId: "turn-1",
      submissionId: "submission-1",
    })
    fixture.controller.acceptEvent({ type: "interaction", interaction: permissionInteraction() })
    assert.throws(
      () => fixture.controller.acceptEvent({ type: "interaction", interaction: permissionInteraction() }),
      /Duplicate CodeM interaction permission-1/,
    )
    fixture.controller.acceptEvent({ type: "interaction", interaction: questionInteraction() })

    await fixture.controller.handle({
      type: "permissionResponse",
      permissionId: "permission-1",
      sessionID: "thread-1",
      response: "reject",
      approvedAlways: [],
      deniedAlways: [],
    })
    assert.deepEqual(fixture.calls.responses.at(-1), {
      requestId: "permission-1",
      response: { kind: "permission", optionId: "reject_once" },
    })
    fixture.controller.acceptEvent({
      type: "interaction-resolved",
      threadId: "thread-1",
      turnId: "turn-1",
      requestId: "permission-1",
      status: "answered",
      error: null,
    })

    // 已解决的 permission 不能再答；过期 requestId 没有权威。
    await fixture.controller.handle({
      type: "permissionResponse",
      permissionId: "permission-1",
      sessionID: "thread-1",
      response: "once",
      approvedAlways: [],
      deniedAlways: [],
    })
    assert.ok(
      fixture.messages.some(
        (message) => message.type === "error" && message.message.includes("is not permission"),
      ),
    )

    await fixture.controller.handle({
      type: "questionReply",
      requestID: "question-1",
      sessionID: "thread-1",
      answers: [["Keep"]],
    })
    assert.deepEqual(fixture.calls.responses.at(-1), {
      requestId: "question-1",
      response: {
        kind: "question",
        cancelled: false,
        answers: [{ question: "Continue?", selected: ["Keep"], freeText: null }],
      },
    })
    fixture.controller.acceptEvent({
      type: "interaction-resolved",
      threadId: "thread-1",
      turnId: "turn-1",
      requestId: "question-1",
      status: "answered",
      error: null,
    })
    await fixture.controller.handle({ type: "questionReject", requestID: "question-1", sessionID: "thread-1" })
    assert.ok(
      fixture.messages.some((message) => message.type === "error" && message.message.includes("is not pending")),
    )

    const createdBefore = fixture.messages.filter((message) => message.type === "messageCreated").length
    fixture.controller.acceptEvent({
      type: "turn-started",
      threadId: "thread-1",
      turnId: "turn-1",
      submissionId: "submission-1",
    })
    assert.equal(
      fixture.messages.filter((message) => message.type === "messageCreated").length,
      createdBefore,
      "duplicate turn-started must not open a second assistant message",
    )

    fixture.controller.acceptEvent({
      type: "turn-started",
      threadId: "thread-other",
      turnId: "turn-9",
      submissionId: "stale-submission",
    })
    fixture.controller.acceptEvent({
      type: "text-delta",
      threadId: "thread-other",
      turnId: "turn-9",
      itemId: "stale-text",
      delta: "should not appear",
    })
    assert.equal(
      fixture.messages.some((message) => message.type === "partUpdated" && message.part.type === "text" && message.part.text === "should not appear"),
      false,
    )
    assertNoKiloCatalog(fixture.messages)
  })

  it("cancels an in-flight turn and fails closed after an unexpected Core crash", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({
      type: "sendMessage",
      sessionID: "thread-1",
      messageID: "submission-cancel",
      text: "Run a long command",
    })
    fixture.controller.acceptEvent({
      type: "turn-started",
      threadId: "thread-1",
      turnId: "turn-cancel",
      submissionId: "submission-cancel",
    })
    await fixture.controller.handle({ type: "abort", sessionID: "thread-1" })
    assert.deepEqual(fixture.calls.interrupt, [{ cwd: "/workspace", threadId: "thread-1" }])
    fixture.controller.acceptEvent({
      type: "turn-completed",
      threadId: "thread-1",
      turnId: "turn-cancel",
      outcome: "stopped",
      stopReason: "interrupted",
      error: null,
    })
    assert.ok(fixture.messages.some((message) => message.type === "sessionTurnClosed" && message.reason === "interrupted"))

    fixture.controller.acceptEvent({
      type: "connection-closed",
      cwd: "/workspace",
      exit: { code: 1, signal: null, expected: false },
    })
    assert.ok(
      fixture.messages.some(
        (message) => message.type === "error" && message.message.includes("exited unexpectedly"),
      ),
    )
    fixture.controller.acceptEvent({
      type: "thread-closed",
      cwd: "/workspace",
      threadId: "thread-1",
      reason: "connection-closed",
    })
    assert.ok(fixture.messages.some((message) => message.type === "threadModesChanged" && message.state === null))

    const sessionsRoot = await mkdtemp(join(tmpdir(), "codem-crash-"))
    temporaryRoots.push(sessionsRoot)
    const history = await writeSchema13HitlSession({
      sessionsRoot,
      cwd: sessionsRoot,
      threadId: "thread-1",
    })
    const reloaded = createFixture()
    reloaded.service.readHistory = async () => history
    await reloaded.controller.handle({ type: "loadMessages", sessionID: "thread-1" })
    const loaded = reloaded.messages.findLast((message) => message.type === "messagesLoaded")
    assert.ok(loaded?.type === "messagesLoaded")
    assert.equal(loaded.mode, "replace")
    assert.equal(loaded.messages[0]?.role, "user")
    assert.equal(
      reloaded.messages.some((message) => message.type === "sessionStatus" && message.status === "busy"),
      false,
      "JSONL reconstruction must not keep a completed run active",
    )
    assertNoKiloCatalog(reloaded.messages)
  })
})

function permissionInteraction(): AppServerInteraction {
  return {
    kind: "permission",
    threadId: "thread-1",
    turnId: "turn-1",
    requestId: "permission-1",
    toolCallId: "call-write-1",
    toolName: "write_file",
    reason: "Create hitl-ok.txt",
    options: [
      { id: "allow_once", label: "Allow once" },
      { id: "reject_once", label: "Reject" },
    ],
    preview: {
      kind: "generic",
      summary: "Write hitl-ok.txt",
    },
  }
}

function questionInteraction(): AppServerInteraction {
  return {
    kind: "question",
    threadId: "thread-1",
    turnId: "turn-1",
    requestId: "question-1",
    questions: [
      {
        id: "q1",
        header: "Confirm",
        question: "Continue?",
        allowsMultipleSelection: false,
        options: [
          { label: "Keep", description: "Continue this turn", preview: null },
          { label: "Stop", description: "Cancel", preview: null },
        ],
      },
    ],
  }
}

function assertNoKiloCatalog(messages: readonly ExtensionMessage[]): void {
  assert.equal(
    messages.some(
      (message) =>
        message.type === "providersLoaded" ||
        message.type === "commandsLoaded" ||
        message.type === "agentsLoaded" ||
        message.type === "imageModelsLoaded",
    ),
    false,
    "Webview must only receive CodeM DTOs",
  )
}

function createFixture() {
  const messages: ExtensionMessage[] = []
  const selected: (string | null)[] = []
  const calls = {
    startThread: [] as Record<string, unknown>[],
    resume: [] as Record<string, unknown>[],
    startTurn: [] as Record<string, unknown>[],
    steerTurn: [] as Record<string, unknown>[],
    responses: [] as Record<string, unknown>[],
    interrupt: [] as Record<string, unknown>[],
  }
  const thread = {
    id: "thread-1",
    cwd: "/workspace",
    archived: false,
    model: "codem-router/auto",
    profile: "default",
    preview: "Create hitl-ok.txt",
    startedAt: "2026-09-17T00:00:00.000Z",
    turnCount: 1,
  } as const
  const service: MatureUiAppServerPort = {
    readModes: async () => ({ revision: 0, permissionEpoch: 0, permissionMode: "default", workMode: "normal" }),
    setModes: async () => ({ revision: 1, permissionEpoch: 1, permissionMode: "auto", workMode: "normal" }),
    startThread: async (cwd, model, intelligence, permissionMode) => {
      calls.startThread.push({ cwd, model, intelligence, ...(permissionMode ? { permissionMode } : {}) })
      return thread.id
    },
    resumeThread: async (cwd, threadId, model, intelligence) => {
      calls.resume.push({
        cwd,
        threadId,
        ...(model ? { model } : {}),
        ...(intelligence ? { intelligence } : {}),
      })
    },
    listThreads: async () => ({ threads: [thread], nextCursor: null, total: 1 }),
    readHistory: async () => ({ turns: [], nextCursor: null }),
    listModels: async () => ({
      activeModel: "codem-router/auto",
      models: [
        {
          id: "codem-router/auto",
          source: "builtin",
          contextWindowTokens: 256000,
          supportsVision: false,
        },
      ],
    }),
    startTurn: async (cwd, threadId, submissionId, text, attachments = []) => {
      calls.startTurn.push({ cwd, threadId, submissionId, text, attachments })
      return "turn-1"
    },
    steerTurn: async (cwd, threadId, submissionId, text) => {
      calls.steerTurn.push({ cwd, threadId, submissionId, text })
    },
    interrupt: async (cwd, threadId) => {
      calls.interrupt.push({ cwd, threadId })
    },
    compactThread: async () => "turn-compact",
    cancelBackgroundTask: async () => "cancelled",
    startSideQuestion: async () => "side-1",
    renameThread: async () => undefined,
    deleteThread: async () => undefined,
    forkThread: async () => thread.id,
    listSkills: async () => [{ name: "review", description: "Review code" }],
    listPermissionProfiles: async () => [
      { id: "default", name: "Default", description: "", settableAtRuntime: true },
      { id: "auto", name: "Auto", description: "", settableAtRuntime: true },
      { id: "yolo", name: "Yolo", description: "", settableAtRuntime: true },
    ],
    rewindThread: async () => "turn-rewind",
    archiveThread: async () => undefined,
    unarchiveThread: async () => undefined,
    clearThread: async () => undefined,
    listLoadedThreadIds: async () => ({ threadIds: [thread.id] }),
    listHooks: async () => ({ cwd: "/workspace", hooks: {} }),
    listPlugins: async () => ({ installed: {}, marketplaces: {} }),
    listTools: async () => ({ threadId: thread.id, model: thread.model, tools: [] }),
    readEnvironmentInfo: async () => ({
      agentName: "codem",
      agentVersion: "0.8.37",
      arch: "arm64",
      cwd: "/workspace",
      os: "macos",
      shell: "/bin/zsh",
    }),
    readConfigSnapshot: async () => ({ writable: false, writeOwner: "core", config: {} }),
    readModelProviderCapabilities: async () => ({ version: "v1", askUser: {}, custom: {} }),
    listBackgroundTerminals: async () => ({ cwd: "/workspace", terminals: [] }),
    terminateBackgroundTerminal: async () => undefined,
    cleanBackgroundTerminals: async () => ({ cwd: "/workspace", results: [] }),
    runShellCommand: async () => undefined,
    cancelSideQuestion: async () => undefined,
    respondToInteraction: async (requestId, response) => {
      calls.responses.push({ requestId, response })
    },
  }
  const controller = new MatureUiAppServerController({
    service,
    cwdForThread: () => "/workspace",
    preparePrompt: async (message) => ({ text: message.text, attachments: [] }),
    post: (message) => messages.push(message),
    selectThread: (threadId) => selected.push(threadId),
  })
  return { controller, messages, selected, calls, service }
}
