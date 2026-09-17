import { historyTurn, historyTool } from "./fixtures/history.ts"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AppServerFileDiff, AppServerHostEvent, AppServerInteraction } from "@codem/app-server"
import { AppServerMatureUiAdapter } from "../../../../src/services/app-server/mature-ui-adapter.ts"

describe("AppServerMatureUiAdapter", () => {
  for (const [outcome, reason, expectedStatus] of [
    ["allow", null, "completed"],
    ["allow", "ok", "completed"],
    ["block", "Policy denied this action", "error"],
    ["error", "Command failed", "error"],
    ["timeout", null, "error"],
    ["success", null, "error"],
  ] as const) {
    it(`projects hook ${outcome} with reason ${String(reason)}`, () => {
      const adapter = new AppServerMatureUiAdapter()
      adapter.accept({ type: "turn-started", threadId: "thread-1", turnId: "turn-1", submissionId: "submission-1" })
      const [message] = adapter.accept({
        type: "hook-completed",
        threadId: "thread-1",
        turnId: "turn-1",
        eventName: "SessionStart",
        toolName: null,
        command: "check.sh",
        outcome,
        reason,
        elapsedMs: 12,
      })
      if (message?.type !== "partUpdated" || message.part.type !== "tool") assert.fail("expected hook part")
      assert.equal(message.part.state.status, expectedStatus)
      if (message.part.state.status === "completed") assert.equal(message.part.state.output, reason ?? "")
      else if (message.part.state.status === "error")
        assert.equal(message.part.state.error, reason ?? `Hook ${outcome}`)
      assert.equal(message.part.state.input.tool, null)
    })
  }

  it("keeps the mature UI optimistic user message pending until Core history confirms it", () => {
    const adapter = new AppServerMatureUiAdapter()

    assert.deepEqual(
      adapter.submissionStarted({
        threadId: "thread-1",
        submissionId: "submission-1",
        text: "Hello",
        createdAt: "2026-09-15T00:00:00.000Z",
      }),
      [{ type: "sessionStatus", sessionID: "thread-1", status: "busy" }],
    )
  })

  it("projects live text, tools, diffs, HITL, plans, and terminal state into the mature UI", () => {
    const adapter = new AppServerMatureUiAdapter()
    const threadId = "thread-1"
    const turnId = "turn-1"

    const messages = adapter.accept({ type: "turn-started", threadId, turnId, submissionId: "submission-1" })
    assert.equal(messages[0]?.type, "messageCreated")
    if (messages[0]?.type !== "messageCreated") assert.fail("expected assistant message")
    assert.deepEqual(
      { ...messages[0].message, createdAt: "<timestamp>" },
      {
        id: "turn-1:assistant",
        sessionID: threadId,
        role: "assistant",
        createdAt: "<timestamp>",
        time: { created: Date.parse(messages[0].message.createdAt) },
      },
    )
    assert.deepEqual(messages[1], { type: "sessionStatus", sessionID: threadId, status: "busy" })

    const [delta] = adapter.accept({
      type: "text-delta",
      threadId,
      turnId,
      itemId: "answer-1",
      delta: "你好！",
    })
    assert.deepEqual(delta, {
      type: "partUpdated",
      sessionID: threadId,
      messageID: "turn-1:assistant",
      part: {
        id: "answer-1",
        type: "text",
        text: "你好！",
        sessionID: threadId,
        messageID: "turn-1:assistant",
      },
      delta: { type: "text-delta", textDelta: "你好！" },
    })
  })

  it("keeps tool correlation and converts a complete CodeM diff for the existing renderer", () => {
    const adapter = new AppServerMatureUiAdapter()
    const threadId = "thread-1"
    const turnId = "turn-1"
    adapter.accept({ type: "turn-started", threadId, turnId, submissionId: "submission-1" })
    const item = {
      id: "item-1",
      type: "commandExecution",
      status: "inProgress",
      callId: "call-1",
      toolName: "run_bash",
      label: "Run tests",
      input: { command: "pnpm test" },
      text: "",
      summary: "",
      output: "",
      isError: false,
      subagentId: null,
      subagentKind: null,
      replaced: null,
      kept: null,
      finalAnswer: null,
    } as const
    const started = adapter.accept({ type: "item-started", threadId, turnId, item })
    assert.equal(started[0]?.type, "partUpdated")
    if (started[0]?.type !== "partUpdated" || started[0].part.type !== "tool") assert.fail("expected tool part")
    assert.equal(started[0].part.tool, "bash")

    adapter.accept({
      type: "item-output-delta",
      threadId,
      turnId,
      itemId: item.id,
      toolCallId: "call-1",
      delta: "running\n",
    })
    adapter.accept({ type: "file-diff", threadId, turnId, itemId: "diff-1", diff: fileDiff() })
    const completed = adapter.accept({
      type: "item-completed",
      threadId,
      turnId,
      item: { ...item, status: "completed", output: "ok" },
    })
    assert.equal(completed[0]?.type, "partUpdated")
    if (completed[0]?.type !== "partUpdated" || completed[0].part.type !== "tool") assert.fail("expected tool part")
    assert.equal(completed[0].part.state.status, "completed")
    if (completed[0].part.state.status !== "completed") assert.fail("expected completed tool")
    assert.match(completed[0].part.state.metadata?.filediff?.patch as string, /^--- a\/src\/example\.ts/mu)
  })

  for (const outcome of ["completed", "stopped", "failed"] as const) {
    it(`settles assistant rendering on ${outcome} before durable history arrives`, () => {
      const adapter = new AppServerMatureUiAdapter()
      const identity = { threadId: "thread-1", turnId: "turn-1" }
      const [start] = adapter.accept({ type: "turn-started", ...identity, submissionId: "submission-1" })
      if (start?.type !== "messageCreated") assert.fail("expected assistant message")
      assert.ok(Number.isFinite(start.message.time?.created))
      assert.equal(start.message.time?.completed, undefined)
      assert.deepEqual(adapter.accept({ type: "turn-started", ...identity, submissionId: "submission-1" }), [])
      const other = adapter.accept({
        type: "turn-started",
        threadId: "thread-2",
        turnId: "turn-1",
        submissionId: "submission-2",
      })
      const terminal: AppServerHostEvent = {
        type: "turn-completed",
        ...identity,
        outcome,
        stopReason: outcome,
        error: outcome === "failed" ? "Core failed" : null,
      }
      const updates = adapter.accept(terminal)
      const end = updates[0]
      if (end?.type !== "messageCreated") assert.fail("expected completed assistant metadata")
      assert.equal(end.message.id, start.message.id)
      assert.equal(end.message.sessionID, identity.threadId)
      assert.equal(end.message.createdAt, start.message.createdAt)
      assert.equal(end.message.time?.created, start.message.time?.created)
      assert.ok(Number.isFinite(end.message.time?.completed))
      assert.equal(end.message.parts, undefined, "metadata update must not replace streamed parts")
      assert.deepEqual(updates[1], { type: "sessionStatus", sessionID: identity.threadId, status: "idle" })
      assert.deepEqual(updates[2], {
        type: "sessionTurnClosed",
        sessionID: identity.threadId,
        eventID: identity.turnId,
        reason: outcome === "stopped" ? "interrupted" : outcome === "failed" ? "error" : "completed",
      })
      assert.equal(
        adapter.accept(terminal).some((event) => event.type === "messageCreated"),
        false,
      )
      assert.equal(other[0]?.type === "messageCreated" && other[0].message.time?.completed, undefined)
    })
  }

  it("supplies creation time for unfinished history as well as completed history", () => {
    const adapter = new AppServerMatureUiAdapter()
    for (const completedAt of [null, "2026-09-15T00:00:01.000Z"]) {
      const loaded = adapter.messagesLoaded({
        threadId: "thread-1",
        turns: [historyTurn(1, completedAt)],
      })
      if (loaded.type !== "messagesLoaded") assert.fail("expected history")
      assert.deepEqual(loaded.messages[1]?.time, {
        created: Date.parse("2026-09-15T00:00:00.000Z"),
        ...(completedAt ? { completed: Date.parse(completedAt) } : {}),
      })
    }
  })

  it("maps permission choices without inventing an unoffered response", () => {
    const adapter = new AppServerMatureUiAdapter()
    const interaction: AppServerInteraction = {
      kind: "permission",
      threadId: "thread-1",
      turnId: "turn-1",
      requestId: "approval-1",
      toolCallId: "call-1",
      toolName: "run_bash",
      reason: "Run tests",
      options: [
        { id: "allow_once", label: "Allow once" },
        { id: "allow_always", label: "Always allow" },
        { id: "reject_once", label: "Reject" },
      ],
      preview: {
        kind: "bash_command",
        cwd: "/workspace",
        command: "pnpm test",
        risk: { kind: "normal" },
        suggestedRules: ["pnpm test"],
      },
    }
    const [message] = adapter.accept({ type: "interaction", interaction })
    assert.equal(message?.type, "permissionRequest")
    assert.deepEqual(adapter.permissionResponse("approval-1", "always"), {
      kind: "permission",
      optionId: "allow_always",
    })
  })

  it("renders the validated final-answer summary instead of losing it behind an internal tool", () => {
    const adapter = new AppServerMatureUiAdapter()
    const threadId = "thread-1"
    const turnId = "turn-1"
    adapter.accept({ type: "turn-started", threadId, turnId, submissionId: "submission-1" })
    const finalItem = historyItem({
      id: "final-1",
      type: "toolCall",
      callId: "call-final-1",
      toolName: "final_answer",
      input: { summary: "Implemented the adapter." },
      finalAnswer: {
        status: "complete",
        kind: "task",
        summary: "Implemented the adapter.",
        artifacts: [],
      },
      recordSeq: 1,
    })
    adapter.accept({ type: "item-started", threadId, turnId, item: { ...finalItem, status: "inProgress" } })
    const completed = adapter.accept({ type: "item-completed", threadId, turnId, item: finalItem })
    assert.equal(completed[1]?.type, "partUpdated")
    if (completed[1]?.type !== "partUpdated" || completed[1].part.type !== "text") {
      assert.fail("expected final-answer text")
    }
    assert.equal(completed[1].part.text, "Implemented the adapter.")
    assert.equal(completed[1].part.synthetic, undefined)
  })

  it("preserves background sub-agents, hooks, and prompt enhancement on the mature message wire", () => {
    const adapter = new AppServerMatureUiAdapter()
    const threadId = "thread-1"
    const turnId = "turn-1"
    adapter.accept({ type: "turn-started", threadId, turnId, submissionId: "submission-1" })
    const subagent = historyItem({
      id: "subagent-item",
      type: "subagent",
      status: "inProgress",
      callId: "subagent-1",
      toolName: "dispatch",
      subagentId: "subagent-1",
      subagentKind: "explore",
      label: "Inspect transport",
      recordSeq: 1,
    })
    const [started] = adapter.accept({ type: "item-started", threadId, turnId, item: subagent })
    assert.equal(started?.type, "partUpdated")
    if (started?.type !== "partUpdated" || started.part.type !== "tool") assert.fail("expected sub-agent tool")
    assert.deepEqual(started.part.state.input, {
      description: "Inspect transport",
      subagent_type: "explore",
    })

    const [background] = adapter.accept({
      type: "background-wake",
      threadId,
      turnId,
      phase: "queued",
      taskId: "subagent-1",
    })
    assert.equal(background?.type, "partUpdated")
    if (background?.type !== "partUpdated" || background.part.type !== "tool") assert.fail("expected background tool")
    assert.equal(background.part.metadata?.background, true)
    assert.deepEqual(adapter.backgroundJobsLoaded(threadId, "jobs-1").jobs, [
      {
        id: "subagent-1",
        type: "task",
        title: "Inspect transport",
        status: "running",
        started_at: adapter.backgroundJobsLoaded(threadId, "jobs-2").jobs[0]?.started_at,
        metadata: { parentSessionId: threadId, sessionId: "subagent-1", background: true },
      },
    ])

    const [hook] = adapter.accept({
      type: "hook-completed",
      threadId,
      turnId,
      eventName: "PostToolUse",
      toolName: "run_bash",
      command: "check.sh",
      outcome: "allow",
      reason: "ok",
      elapsedMs: 12,
    })
    assert.equal(hook?.type, "partUpdated")
    if (hook?.type !== "partUpdated" || hook.part.type !== "tool") assert.fail("expected hook tool")
    assert.equal(hook.part.state.status, "completed")

    adapter.accept({
      type: "side-question-started",
      threadId,
      operationId: "enhance-1",
      sideQuestionId: "side-1",
      question: "Improve this prompt",
    })
    adapter.accept({ type: "side-question-delta", threadId, sideQuestionId: "side-1", delta: "Improved " })
    adapter.accept({ type: "side-question-delta", threadId, sideQuestionId: "side-1", delta: "prompt" })
    assert.deepEqual(
      adapter.accept({
        type: "side-question-completed",
        threadId,
        sideQuestionId: "side-1",
        status: "completed",
        error: null,
      }),
      [{ type: "enhancePromptResult", requestId: "enhance-1", text: "Improved prompt" }],
    )
  })

  it("reopens three projected turns without mixing answers and keeps complete tool arguments/output", () => {
    const adapter = new AppServerMatureUiAdapter()
    const turns = [1, 2, 3].map((n) => historyTurn(n))
    const loaded = adapter.messagesLoaded({ threadId: "thread-1", turns })
    assert.ok(loaded.type === "messagesLoaded")
    assert.deepEqual(
      loaded.messages.map((message) => message.role),
      ["user", "assistant", "user", "assistant", "user", "assistant"],
    )
    for (let n = 1; n <= 3; n++) {
      const user = loaded.messages[n * 2 - 2]!
      assert.equal(user.parts?.[0]?.type, "text")
      assert.equal(user.parts?.[0]?.type === "text" && user.parts[0].text, `question ${n}`)
      assert.equal(user.parts?.[0]?.messageID, user.id)
      const parts = loaded.messages[n * 2 - 1]?.parts
      assert.deepEqual(
        parts?.filter((part) => part.type === "text").map((part) => part.text),
        [`answer ${n}`],
      )
      const tool = parts?.find((part) => part.type === "tool")
      assert.deepEqual(tool?.state.input, { kind: "chat", status: "complete", summary: `summary ${n}` })
      assert.ok(tool?.state.status === "completed")
      assert.equal(tool.state.output, "accepted")
    }
  })

  it("does not mix delayed durable parts into a live turn or reverse its terminal result", () => {
    const adapter = new AppServerMatureUiAdapter()
    adapter.accept({ type: "turn-started", threadId: "thread-1", turnId: "live-id", submissionId: "submission-1" })
    const input = { threadId: "thread-1", turns: [historyTurn(1, null)], mode: "reconcile" as const }
    assert.deepEqual(adapter.messagesLoaded(input), {
      type: "messagesLoaded",
      sessionID: "thread-1",
      messages: [],
      mode: "reconcile",
    })
    adapter.accept({
      type: "turn-completed",
      threadId: "thread-1",
      turnId: "live-id",
      outcome: "completed",
      stopReason: "end_turn",
      error: null,
    })
    const delayed = adapter.messagesLoaded(input)
    assert.ok(delayed.type === "messagesLoaded")
    assert.equal(delayed.messages.length, 0)
    const reopened = adapter.messagesLoaded({ ...input, turns: [historyTurn()], mode: "replace" })
    assert.ok(reopened.type === "messagesLoaded")
    assert.equal(reopened.messages.length, 2)
  })

  it("preserves tool payloads longer than the shared preview", () => {
    const entry = historyTurn()
    const output = "x".repeat(8000)
    const turn = { ...entry.turn, items: [...entry.turn.items, historyTool(2, output)] }
    const loaded = new AppServerMatureUiAdapter().messagesLoaded({ threadId: "thread-1", turns: [{ ...entry, turn }] })
    assert.ok(loaded.type === "messagesLoaded")
    const tool = loaded.messages[1]?.parts?.at(-1)
    assert.ok(tool?.type === "tool" && tool.state.status === "completed")
    assert.equal(tool.state.output, output)
  })
})

function fileDiff(): AppServerFileDiff {
  return {
    source: { kind: "tool", toolCallId: "call-1" },
    path: "src/example.ts",
    changeType: "modified",
    stats: { linesAdded: 1, linesRemoved: 0 },
    preview: {
      kind: "complete",
      hunks: [
        {
          oldStart: 1,
          oldCount: 1,
          newStart: 1,
          newCount: 2,
          lines: [
            { kind: "context", oldLine: 1, newLine: 1, text: "const before = true" },
            { kind: "insert", oldLine: null, newLine: 2, text: "const after = true" },
          ],
        },
      ],
    },
  }
}

function historyItem(
  overrides: Partial<Extract<AppServerHostEvent, { readonly type: "item-completed" }>["item"]> & {
    readonly id: string
    readonly type: Extract<AppServerHostEvent, { readonly type: "item-completed" }>["item"]["type"]
    readonly recordSeq: number
  },
) {
  return {
    id: overrides.id,
    type: overrides.type,
    status: "completed" as const,
    callId: null,
    toolName: null,
    label: overrides.type,
    input: null,
    text: "",
    summary: "",
    output: "",
    isError: false,
    subagentId: null,
    subagentKind: null,
    replaced: null,
    kept: null,
    finalAnswer: null,
    turnId: "turn-1",
    submissionId: "submission-1",
    ...overrides,
  }
}
