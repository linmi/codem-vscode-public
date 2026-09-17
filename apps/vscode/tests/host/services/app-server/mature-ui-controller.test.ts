import { historyTurn } from "./fixtures/history.ts"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AppServerInteraction } from "@codem/app-server"
import type { ExtensionMessage } from "../../../../webview-ui/src/types/messages/extension-messages"
import {
  APP_SERVER_MATURE_UI_COMMANDS,
  MatureUiAppServerController,
  type MatureUiAppServerPort,
} from "../../../../src/services/app-server/mature-ui-controller.ts"

describe("MatureUiAppServerController", () => {
  it("owns only commands with a complete App Server v1 mapping", async () => {
    const fixture = createFixture()
    assert.deepEqual(APP_SERVER_MATURE_UI_COMMANDS, [
      "requestThreadModes",
      "setThreadPermissionMode",
      "abort",
      "cancelBackgroundJob",
      "compact",
      "createSession",
      "deleteSession",
      "enhancePrompt",
      "forkSession",
      "loadMessages",
      "loadSessions",
      "permissionResponse",
      "questionReject",
      "questionReply",
      "renameSession",
      "requestBackgroundJobs",
      "requestProviders",
      "requestSkills",
      "sendCommand",
      "sendMessage",
    ])
    assert.equal(await fixture.controller.handle({ type: "loadSessions" }), true)
    assert.equal(
      await fixture.controller.handle({ type: "promoteBackgroundJob", sessionID: "thread-1", jobID: "bg-1" }),
      false,
    )
    assert.equal(fixture.messages[0]?.type, "sessionsLoaded")
  })

  it("projects the online Core model catalog as the CodeM model selector", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "requestProviders" })
    assert.deepEqual(fixture.messages.at(-1), {
      type: "providersLoaded",
      providers: {
        "codem-router": {
          id: "codem-router",
          name: "CodeM",
          source: "api",
          models: {
            auto: {
              id: "auto",
              name: "CodeM 智能选择",
              contextLength: 256000,
              capabilities: {
                reasoning: true,
                input: { text: true, image: false, audio: false, video: false, pdf: false },
              },
              variants: { low: {}, medium: {}, high: {}, xhigh: {} },
            },
          },
        },
      },
      connected: ["codem-router"],
      defaults: { "codem-router": "auto" },
      organizationId: null,
      ready: true,
      defaultSelection: { providerID: "codem-router", modelID: "auto" },
      authMethods: {},
      authStates: {},
    })
  })

  it("creates Core-owned thread ids and starts or steers correlated submissions", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    assert.deepEqual(fixture.selected, ["thread-1"])
    assert.equal(fixture.messages[0]?.type, "sessionCreated")

    await fixture.controller.handle({
      type: "sendMessage",
      sessionID: "thread-1",
      messageID: "submission-1",
      text: "Build it",
    })
    assert.deepEqual(fixture.calls.startTurn, [
      { cwd: "/workspace", threadId: "thread-1", submissionId: "submission-1", text: "Build it", attachments: [] },
    ])
    fixture.controller.acceptEvent({
      type: "turn-started",
      threadId: "thread-1",
      turnId: "turn-1",
      submissionId: "submission-1",
    })
    await fixture.controller.handle({
      type: "sendMessage",
      sessionID: "thread-1",
      messageID: "submission-2",
      text: "Also update docs",
      variant: "high",
    })
    assert.deepEqual(fixture.calls.steerTurn, [
      { cwd: "/workspace", threadId: "thread-1", submissionId: "submission-2", text: "Also update docs" },
    ])
    assert.deepEqual(fixture.calls.resume, [])
  })

  it("reconciles an initial history response without erasing an active live turn", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    fixture.controller.acceptEvent({
      type: "turn-started",
      threadId: "thread-1",
      turnId: "turn-1",
      submissionId: "submission-1",
    })

    await fixture.controller.handle({ type: "loadMessages", sessionID: "thread-1", mode: "replace" })

    const loaded = fixture.messages.findLast((message) => message.type === "messagesLoaded")
    assert.ok(loaded)
    if (loaded.type !== "messagesLoaded") assert.fail("expected messagesLoaded")
    assert.equal(loaded.mode, "reconcile")
  })

  it("passes the preselected model, intelligence and permission mode with the first send", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({
      type: "sendMessage",
      messageID: "submission-1",
      text: "Hello",
      providerID: "codem-router",
      modelID: "auto",
      variant: "high",
      permissionMode: "yolo",
    })
    assert.deepEqual(fixture.calls.startThread, [
      { cwd: "/workspace", model: "codem-router/auto", intelligence: "high", permissionMode: "yolo" },
    ])
  })

  it("creates a draft in a new thread even when the controller previously selected another thread", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    await fixture.controller.handle({
      type: "sendMessage",
      draftID: "draft-2",
      text: "New",
      variant: "medium",
      permissionMode: "auto",
    })
    assert.equal(fixture.calls.startThread.length, 2)
    assert.equal(fixture.calls.startThread[1]?.permissionMode, "auto")
  })

  it("rejects invalid initial modes and attempts to bypass revision-checked changes on existing threads", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "sendMessage", text: "Invalid", permissionMode: "acceptEdits" as never })
    assert.equal(fixture.calls.startThread.length, 0)
    await fixture.controller.handle({
      type: "sendMessage",
      sessionID: "thread-1",
      text: "Bypass",
      permissionMode: "yolo",
    })
    assert.equal(fixture.calls.startTurn.length, 0)
    assert.equal(fixture.messages.filter((message) => message.type === "sendMessageFailed").length, 2)
  })

  it("forwards initial presets through slash commands", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({
      type: "sendCommand",
      draftID: "draft",
      command: "help",
      arguments: "",
      variant: "medium",
      permissionMode: "auto",
    })
    assert.equal(fixture.calls.startThread[0]?.permissionMode, "auto")
    assert.equal(fixture.calls.startThread[0]?.intelligence, "medium")
  })

  it("applies a changed intelligence tier before the next idle turn", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    await fixture.controller.handle({
      type: "sendMessage",
      sessionID: "thread-1",
      messageID: "submission-1",
      text: "Think harder",
      providerID: "codem-router",
      modelID: "auto",
      variant: "xhigh",
    })
    assert.deepEqual(fixture.calls.resume, [
      {
        cwd: "/workspace",
        threadId: "thread-1",
        model: "codem-router/auto",
        intelligence: "xhigh",
      },
    ])
  })

  it("rejects an intelligence value outside Core's advertised tiers", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({
      type: "sendMessage",
      messageID: "submission-1",
      text: "Hello",
      providerID: "codem-router",
      modelID: "auto",
      variant: "max",
    })
    assert.equal(fixture.calls.startThread.length, 0)
    assert.deepEqual(fixture.messages.at(-1), {
      type: "sendMessageFailed",
      error: "CodeM intelligence max is not supported by the selected model",
      text: "Hello",
      messageID: "submission-1",
    })
  })

  it("loads durable history by turn and keeps Core pagination identity", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "loadMessages", sessionID: "thread-1", limit: 20 })
    const loaded = fixture.messages.find((message) => message.type === "messagesLoaded")
    assert.ok(loaded)
    if (loaded.type !== "messagesLoaded") assert.fail("expected messagesLoaded")
    assert.equal(loaded.sessionID, "thread-1")
    assert.equal(loaded.cursor, "turn-cursor-2")
    assert.equal(loaded.hasMore, true)
    assert.deepEqual(
      loaded.messages.map((message) => message.role),
      ["user", "assistant"],
    )
    assert.deepEqual(fixture.calls.resume, [{ cwd: "/workspace", threadId: "thread-1" }])
  })

  it("discards a history response after the user clears selection", async () => {
    const fixture = createFixture()
    let begin!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      begin = resolve
    })
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    fixture.service.readHistory = async () => {
      begin()
      await pending
      return { turns: [historyTurn()], nextCursor: null }
    }
    const loading = fixture.controller.handle({ type: "loadMessages", sessionID: "thread-1" })
    await started
    fixture.controller.clearSelection()
    release()
    await loading
    assert.equal(
      fixture.messages.some((m) => m.type === "messagesLoaded"),
      false,
    )
  })

  it("keeps terminal live authority when completion races a history snapshot", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    fixture.controller.acceptEvent({
      type: "turn-started",
      threadId: "thread-1",
      turnId: "live",
      submissionId: "submission-1",
    })
    fixture.service.readHistory = async () => {
      fixture.controller.acceptEvent({
        type: "turn-completed",
        threadId: "thread-1",
        turnId: "live",
        outcome: "completed",
        stopReason: "end_turn",
        error: null,
      })
      return { turns: [historyTurn(1, null)], nextCursor: null }
    }
    await fixture.controller.handle({ type: "loadMessages", sessionID: "thread-1" })
    const loaded = fixture.messages.find((m) => m.type === "messagesLoaded")
    assert.ok(loaded?.type === "messagesLoaded")
    assert.equal(loaded.mode, "reconcile")
    assert.deepEqual(loaded.messages, [])
  })

  it("reports JSONL recovery errors without publishing or falling back to RPC history", async () => {
    const fixture = createFixture()
    fixture.service.readHistory = async () => {
      throw new Error("unsupported schema_version 99")
    }
    await fixture.controller.handle({ type: "loadMessages", sessionID: "thread-1" })
    assert.equal(
      fixture.messages.some((message) => message.type === "messagesLoaded"),
      false,
    )
    assert.ok(
      fixture.messages.some((message) => message.type === "error" && message.message.includes("schema_version")),
    )
  })

  it("routes HITL answers and background cancellation without inventing responses", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    const interaction: AppServerInteraction = {
      kind: "permission",
      threadId: "thread-1",
      turnId: "turn-1",
      requestId: "permission-1",
      toolCallId: "call-1",
      toolName: "run_bash",
      reason: "Run tests",
      options: [
        { id: "allow_once", label: "Allow once" },
        { id: "reject_once", label: "Reject" },
      ],
      preview: {
        kind: "bash_command",
        cwd: "/workspace",
        command: "pnpm test",
        risk: {},
        suggestedRules: [],
      },
    }
    fixture.controller.acceptEvent({ type: "interaction", interaction })
    await fixture.controller.handle({
      type: "permissionResponse",
      permissionId: "permission-1",
      sessionID: "thread-1",
      response: "once",
      approvedAlways: [],
      deniedAlways: [],
    })
    assert.deepEqual(fixture.calls.responses, [
      { requestId: "permission-1", response: { kind: "permission", optionId: "allow_once" } },
    ])

    await fixture.controller.handle({
      type: "cancelBackgroundJob",
      sessionID: "thread-1",
      jobID: "bg-1",
      requestID: "jobs-1",
    })
    assert.deepEqual(fixture.calls.cancelBackground, [{ cwd: "/workspace", threadId: "thread-1", taskId: "bg-1" }])
    assert.equal(fixture.messages.at(-1)?.type, "backgroundJobsLoaded")
  })

  it("reads and changes a specific thread mode with Core revision and correlated replies", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "requestThreadModes", sessionID: "thread-1", requestID: "read-1" })
    assert.deepEqual(fixture.messages.at(-1), {
      type: "threadModesResult",
      sessionID: "thread-1",
      requestID: "read-1",
      result: { state: { revision: 0, permissionEpoch: 0, permissionMode: "default", workMode: "normal" } },
    })
    fixture.service.setModes = async (input) => {
      assert.deepEqual(input, { cwd: "/workspace", threadId: "thread-1", expectedRevision: 0, permissionMode: "auto" })
      return { revision: 1, permissionEpoch: 1, permissionMode: "auto", workMode: "normal" }
    }
    await fixture.controller.handle({
      type: "setThreadPermissionMode",
      sessionID: "thread-1",
      requestID: "set-1",
      expectedRevision: 0,
      permissionMode: "auto",
    })
    assert.equal(fixture.messages.at(-1)?.type, "threadModesResult")
    fixture.service.setModes = async () => {
      throw new Error("Session mode revision conflict")
    }
    await fixture.controller.handle({
      type: "setThreadPermissionMode",
      sessionID: "thread-1",
      requestID: "stale-1",
      expectedRevision: 0,
      permissionMode: "yolo",
    })
    assert.deepEqual(fixture.messages.at(-1), {
      type: "threadModesResult",
      sessionID: "thread-1",
      requestID: "stale-1",
      result: { error: "Session mode revision conflict" },
    })
  })

  it("broadcasts confirmed mode changes and invalidates the mode after a connection closes", async () => {
    const fixture = createFixture()
    await fixture.controller.handle({ type: "createSession" })
    const state = { revision: 3, permissionEpoch: 2, permissionMode: "yolo", workMode: "plan" } as const
    fixture.controller.acceptEvent({ type: "thread-modes-updated", threadId: "other-thread", state })
    assert.equal(fixture.messages.filter((message) => message.type === "threadModesChanged").length, 0)
    fixture.controller.acceptEvent({ type: "thread-modes-updated", threadId: "thread-1", state })
    assert.deepEqual(fixture.messages.at(-1), { type: "threadModesChanged", sessionID: "thread-1", state })
    fixture.controller.acceptEvent({
      type: "thread-closed",
      threadId: "thread-1",
      cwd: "/workspace",
      reason: "connection-closed",
    })
    assert.ok(fixture.messages.some((message) => message.type === "threadModesChanged" && message.state === null))
  })

  it("returns mature UI error messages for rejected sends", async () => {
    const fixture = createFixture({ prepareError: new Error("Attachment escaped the workspace") })
    await fixture.controller.handle({
      type: "sendMessage",
      sessionID: "thread-1",
      messageID: "submission-1",
      text: "Inspect this",
    })
    assert.deepEqual(fixture.messages.at(-1), {
      type: "sendMessageFailed",
      error: "Attachment escaped the workspace",
      text: "Inspect this",
      sessionID: "thread-1",
      messageID: "submission-1",
    })
  })
})

function createFixture(options: { readonly prepareError?: Error } = {}) {
  const messages: ExtensionMessage[] = []
  const selected: (string | null)[] = []
  const calls = {
    startThread: [] as Record<string, unknown>[],
    resume: [] as Record<string, unknown>[],
    startTurn: [] as Record<string, unknown>[],
    steerTurn: [] as Record<string, unknown>[],
    responses: [] as Record<string, unknown>[],
    cancelBackground: [] as Record<string, unknown>[],
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
    readHistory: async () => ({ turns: [historyTurn()], nextCursor: "turn-cursor-2" }),
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
    interrupt: async () => undefined,
    compactThread: async () => "turn-compact",
    cancelBackgroundTask: async (cwd, threadId, taskId) => {
      calls.cancelBackground.push({ cwd, threadId, taskId })
      return "cancelled"
    },
    startSideQuestion: async () => "side-1",
    renameThread: async () => undefined,
    deleteThread: async () => undefined,
    forkThread: async () => thread.id,
    listSkills: async () => [{ name: "review", description: "Review code" }],
    respondToInteraction: async (requestId, response) => {
      calls.responses.push({ requestId, response })
    },
  }
  const controller = new MatureUiAppServerController({
    service,
    cwdForThread: () => "/workspace",
    preparePrompt: async (message) => {
      if (options.prepareError) throw options.prepareError
      return { text: message.text, attachments: [] }
    },
    post: (message) => messages.push(message),
    selectThread: (threadId) => selected.push(threadId),
  })
  return { controller, messages, selected, calls, service }
}
