import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Part, ToolPart } from "@codem/ui/types/session"
import { toolDefaultOpen } from "../../../webview-ui/src/components/chat/tool-default-open.ts"

function tool(name: string) {
  return { type: "tool", tool: name } as ToolPart
}

describe("toolDefaultOpen", () => {
  it("uses the terminal preference for bash and background_process", () => {
    for (const name of ["bash", "background_process"]) {
      assert.equal(toolDefaultOpen(tool(name), false, true), false)
      assert.equal(toolDefaultOpen(tool(name), true, false), true)
      assert.equal(toolDefaultOpen(tool(name), true, false, false), true)
    }
  })

  it("uses the code edit preference for edit, write, and apply_patch", () => {
    for (const name of ["edit", "write", "apply_patch"]) {
      assert.equal(toolDefaultOpen(tool(name), true, false), false)
      assert.equal(toolDefaultOpen(tool(name), false, true), true)
      assert.equal(toolDefaultOpen(tool(name), false, true, false), true)
    }
  })

  it("uses the mcp preference for non-builtin tools", () => {
    for (const name of [
      "slack_post_message",
      "github_create_issue",
      "discord_search_messages",
      "list_mcp_resources",
      "custom_mcp_tool",
    ]) {
      assert.equal(toolDefaultOpen(tool(name), false, false, true), true)
      assert.equal(toolDefaultOpen(tool(name), true, true, false), false)
      assert.equal(toolDefaultOpen(tool(name), true, true), undefined)
    }
  })

  it("leaves unrelated parts unchanged", () => {
    assert.equal(toolDefaultOpen(tool("read"), true, true, true), undefined)
    assert.equal(toolDefaultOpen(tool("glob"), true, true, true), undefined)
    assert.equal(toolDefaultOpen(tool("grep"), true, true, true), undefined)
    assert.equal(toolDefaultOpen(tool("task"), true, true, true), undefined)
    assert.equal(toolDefaultOpen({ type: "text" } as Part, true, true, true), undefined)
  })
})
