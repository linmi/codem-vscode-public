import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { AppServerPermissionMode } from "@codem/app-server/modes"
import { createThreadPermissions } from "../../../../webview-ui/src/context/thread-permissions"
import type { ThreadPermissionView } from "../../../../webview-ui/src/utils/thread-permission-state"
import type { WebviewMessage } from "../../../../webview-ui/src/types/messages"

function fixture() {
  const views: Record<string, ThreadPermissionView> = {}
  const drafts: Record<string, AppServerPermissionMode> = {}
  const messages: WebviewMessage[] = []
  const permissions = createThreadPermissions({
    views: () => views,
    setView: (id, view) => {
      views[id] = view
    },
    drafts: () => drafts,
    setDraft: (id, mode) => {
      drafts[id] = mode
    },
    deleteDraft: (id) => {
      delete drafts[id]
    },
    defaultMode: () => "auto",
    post: (message) => {
      messages.push(message)
    },
  })
  return { permissions, messages }
}

const state = { revision: 2, permissionEpoch: 1, permissionMode: "auto", workMode: "normal" } as const

describe("composer permission ownership", () => {
  it("preselects Auto and keeps draft choices local and isolated until submission", () => {
    const { permissions, messages } = fixture()
    assert.equal(permissions.draftMode("draft-a"), "auto")
    permissions.selectDraft("yolo", "draft-a")
    assert.equal(permissions.draftMode("draft-a"), "yolo")
    assert.equal(permissions.draftMode("draft-b"), "auto")
    assert.deepEqual(messages, [])
  })

  it("keeps a submitted draft choice for retries without changing the next new thread's default", () => {
    const { permissions, messages } = fixture()
    permissions.selectDraft("yolo")
    assert.equal(permissions.submitDraft(undefined, "new-draft"), "yolo")
    assert.equal(permissions.draftMode("new-draft"), "yolo")
    assert.equal(permissions.draftMode(), "auto")
    assert.equal(permissions.submitDraft("new-draft", "new-draft"), "yolo")
    assert.deepEqual(messages, [])
  })

  it("coalesces reads and reuses synchronized state across repeated tab visits", () => {
    const { permissions, messages } = fixture()
    permissions.read("a")
    permissions.read("a")
    const requestID = permissions.view("a").requestID!
    permissions.accept({ type: "threadModesResult", sessionID: "a", requestID, result: { state } })
    permissions.read("b")
    permissions.read("a")
    assert.equal(messages.length, 2)
    permissions.accept({
      type: "threadModesChanged",
      sessionID: "a",
      state: { ...state, revision: 3, permissionMode: "yolo" },
    })
    assert.equal(permissions.view("a").state?.permissionMode, "yolo")
    permissions.read("a")
    assert.equal(messages.length, 2)
  })

  it("requires explicit retry after failure and never reports an unconfirmed selection", () => {
    const { permissions, messages } = fixture()
    permissions.accept({ type: "threadModesChanged", sessionID: "a", state })
    permissions.select("a", "yolo")
    assert.equal(permissions.view("a").state?.permissionMode, "auto")
    const requestID = permissions.view("a").requestID!
    permissions.accept({ type: "threadModesResult", sessionID: "a", requestID, result: { error: "Revision conflict" } })
    permissions.read("a")
    assert.equal(messages.length, 1)
    assert.equal(permissions.view("a").state, null)
    permissions.read("a", true)
    assert.equal(messages.length, 2)
  })

  it("invalidates retired replies and synchronizes once when restored", () => {
    const { permissions, messages } = fixture()
    permissions.read("a")
    const requestID = permissions.view("a").requestID!
    permissions.accept({ type: "threadModesChanged", sessionID: "a", state: null })
    permissions.accept({ type: "threadModesResult", sessionID: "a", requestID, result: { state } })
    assert.equal(permissions.view("a").state, null)
    permissions.read("a")
    permissions.read("a")
    assert.equal(messages.length, 2)
    assert.notEqual(permissions.view("a").requestID, requestID)
  })
})
