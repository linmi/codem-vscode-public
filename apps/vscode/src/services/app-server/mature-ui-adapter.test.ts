import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AppServerFileDiff, AppServerHostEvent, AppServerInteraction } from "@codem/app-server"
import { AppServerMatureUiAdapter } from "./mature-ui-adapter.ts"

describe("AppServerMatureUiAdapter", () => {
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
    assert.equal(completed[1].part.synthetic, true)
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
      outcome: "success",
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

  it("reconstructs user, reasoning, tool, and assistant history by Core turn identity", () => {
    const adapter = new AppServerMatureUiAdapter()
    const message = adapter.messagesLoaded({
      threadId: "thread-1",
      turns: [
        {
          id: "turn-1",
          input: "Build it",
          submissionId: "submission-1",
          startedAt: "2026-09-15T00:00:00.000Z",
          completedAt: "2026-09-15T00:00:01.000Z",
          status: "completed",
          itemsView: "full",
        },
      ],
      items: [
        historyItem({ id: "reason-1", type: "reasoning", text: "Thinking", recordSeq: 1 }),
        historyItem({
          id: "tool-1",
          type: "toolCall",
          status: "inProgress",
          toolName: "read_file",
          callId: "call-1",
          recordSeq: 2,
        }),
        historyItem({
          id: "result-1",
          type: "toolResult",
          callId: "call-1",
          output: "file body",
          recordSeq: 3,
        }),
        historyItem({ id: "answer-1", type: "agentMessage", text: "Done", recordSeq: 4 }),
      ],
    })
    assert.equal(message.type, "messagesLoaded")
    if (message.type !== "messagesLoaded") assert.fail("expected history")
    assert.deepEqual(
      message.messages.map((entry) => [entry.role, entry.id]),
      [
        ["user", "submission-1"],
        ["assistant", "turn-1:assistant"],
      ],
    )
    assert.deepEqual(
      message.messages[1]?.parts?.map((part) => part.type),
      ["reasoning", "tool", "text"],
    )
    const tool = message.messages[1]?.parts?.[1]
    assert.equal(tool?.type, "tool")
    if (tool?.type !== "tool") assert.fail("expected merged history tool")
    assert.deepEqual(tool.state, {
      status: "completed",
      input: {},
      output: "file body",
      title: "toolCall",
      metadata: { appServerStatus: "completed", appServerTool: "read_file" },
    })
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
