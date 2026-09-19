import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { mergeAppServerItems, parseAppServerFileDiff, parseAppServerItem } from "../src/index.ts"

describe("App Server item projection", () => {
  it("preserves a started tool's identity and input when completion omits them", () => {
    const started = parseAppServerItem(
      {
        id: "item-1",
        type: "commandExecution",
        status: "inProgress",
        tool: "run_bash",
        callId: "call-1",
        arguments: { command: "pwd" },
      },
      "started item",
    )
    const completed = parseAppServerItem(
      {
        id: "item-1",
        type: "commandExecution",
        status: "completed",
        callId: "call-1",
        output: "/workspace",
      },
      "completed item",
    )
    assert.deepEqual(mergeAppServerItems(started, completed), {
      ...completed,
      toolName: "run_bash",
      label: "run_bash",
      input: { command: "pwd" },
    })
  })

  it("rejects unknown item kinds instead of leaking raw protocol data", () => {
    assert.throws(
      () => parseAppServerItem({ id: "item-1", type: "futureItem", status: "completed" }, "item"),
      /item\.type has invalid value futureItem/u,
    )
  })

  it("accepts the durable toolResult record returned by thread/items/list", () => {
    assert.deepEqual(
      parseAppServerItem(
        {
          id: "result-1",
          type: "toolResult",
          status: "completed",
          callId: "call-1",
          output: "done",
        },
        "history item",
      ),
      {
        id: "result-1",
        type: "toolResult",
        status: "completed",
        callId: "call-1",
        toolName: null,
        label: "toolResult",
        input: null,
        text: "",
        summary: "",
        output: "done",
        isError: false,
        subagentId: null,
        subagentKind: null,
        replaced: null,
        kept: null,
        finalAnswer: null,
      },
    )
  })

  it("normalizes and validates the structured final answer from current Core", () => {
    const started = parseAppServerItem(
      {
        id: "final-1",
        type: "toolCall",
        status: "inProgress",
        tool: "final_answer",
        callId: "call-final-1",
        arguments: {
          summary: "Implemented the adapter.",
          artifacts: [{ kind: "file", title: "Adapter", path: "src/adapter.ts" }],
        },
      },
      "final answer",
    )
    const completed = parseAppServerItem(
      {
        id: "final-1",
        type: "toolCall",
        status: "completed",
        tool: "final_answer",
        callId: "call-final-1",
      },
      "final answer completion",
    )
    assert.deepEqual(mergeAppServerItems(started, completed).finalAnswer, {
      status: "complete",
      kind: "task",
      summary: "Implemented the adapter.",
      artifacts: [
        {
          kind: "file",
          title: "Adapter",
          source: null,
          uri: null,
          path: "src/adapter.ts",
          filename: null,
          alt: null,
          mime: null,
          spec: null,
        },
      ],
    })
    assert.throws(
      () =>
        parseAppServerItem(
          {
            id: "final-2",
            type: "toolCall",
            status: "completed",
            tool: "final_answer",
            arguments: { summary: "Done", unexpected: true },
          },
          "final answer",
        ),
      /unsupported fields: unexpected/u,
    )
  })

  it("rejects a complete diff whose stats do not match its hunks", () => {
    assert.throws(
      () =>
        parseAppServerFileDiff(
          {
            tool_call_id: "call-1",
            path: "src/example.ts",
            change_type: "modified",
            is_binary: false,
            truncated: false,
            stats: { lines_added: 0, lines_removed: 0 },
            hunks: [
              {
                old_start: 0,
                old_count: 0,
                new_start: 1,
                new_count: 1,
                lines: [{ kind: "insert", old_line: null, new_line: 1, text: "added" }],
              },
            ],
            raw_unified: null,
          },
          "call-1",
          null,
          "diff",
        ),
      /stats do not match complete hunks/u,
    )
  })

  it("rejects a background diff whose envelope and payload identities differ", () => {
    assert.throws(
      () =>
        parseAppServerFileDiff(
          {
            tool_call_id: "call-1",
            background_task_id: "task-other",
            path: "src/example.ts",
            change_type: "new",
            is_binary: false,
            truncated: false,
            stats: { lines_added: 0, lines_removed: 0 },
            hunks: [],
            raw_unified: null,
          },
          "call-1",
          "task-1",
          "diff",
        ),
      /changed background_task_id/u,
    )
  })
})
