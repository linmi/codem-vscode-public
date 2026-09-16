import { DEFAULT_PROMPT_SETTINGS } from "../../../../src/shared/prompt-defaults"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { readFileSync } from "node:fs"
import { MatureUiAppServerController } from "../../../../src/services/app-server/mature-ui-controller.ts"
import {
  acceptThreadPermissionMessage,
  emptyThreadPermissionView,
} from "../../../../webview-ui/src/utils/thread-permission-state"

const state = { revision: 2, permissionEpoch: 1, permissionMode: "auto", workMode: "normal" } as const
describe("thread permission presentation", () => {
  it("never treats cross-thread or superseded request replies as authoritative", () => {
    const view = { ...emptyThreadPermissionView("a"), requestID: "read-2" }
    assert.equal(acceptThreadPermissionMessage(view, { type: "threadModesChanged", sessionID: "b", state }), view)
    assert.equal(
      acceptThreadPermissionMessage(view, {
        type: "threadModesResult",
        sessionID: "a",
        requestID: "read-1",
        result: { state },
      }),
      view,
    )
  })
  it("keeps a newer broadcast when an older read finishes and invalidates state on disconnect", () => {
    const view = { ...emptyThreadPermissionView("a"), requestID: "r" }
    const broadcast = acceptThreadPermissionMessage(view, { type: "threadModesChanged", sessionID: "a", state })
    assert.equal(broadcast.requestID, "r")
    const read = acceptThreadPermissionMessage(broadcast, {
      type: "threadModesResult",
      sessionID: "a",
      requestID: "r",
      result: { state: { ...state, revision: 1 } },
    })
    assert.equal(read.state?.revision, 2)
    assert.equal(read.requestID, null)
    const closed = acceptThreadPermissionMessage(broadcast, { type: "threadModesChanged", sessionID: "a", state: null })
    assert.deepEqual(closed, emptyThreadPermissionView("a"))
    assert.equal(
      acceptThreadPermissionMessage(closed, {
        type: "threadModesResult",
        sessionID: "a",
        requestID: "r",
        result: { state },
      }),
      closed,
    )
  })
  it("shows a rejected write without claiming the requested mode was applied", () => {
    const view = { ...emptyThreadPermissionView("a"), state, requestID: "write" }
    assert.deepEqual(
      acceptThreadPermissionMessage(view, {
        type: "threadModesResult",
        sessionID: "a",
        requestID: "write",
        result: { error: "Revision conflict" },
      }),
      { sessionID: "a", requestID: null, state: null, error: "Revision conflict" },
    )
  })
  it("removes the old global approval command and configuration instead of aliasing them", () => {
    const controller = new MatureUiAppServerController({} as never)
    assert.equal(controller.accepts("toggleAutoApprove" as never), false)
    assert.equal(controller.accepts("requestAutoApproveState" as never), false)
    const manifest = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"))
    assert.equal(
      manifest.contributes.commands.some(
        (command: { command: string }) => command.command === "codem.toggleAutoApprove",
      ),
      false,
    )
    assert.equal("codem.autoApprove.enabled" in manifest.contributes.configuration.properties, false)
    assert.equal(
      manifest.contributes.configuration.properties["codem.permissionMode"].default,
      DEFAULT_PROMPT_SETTINGS.permissionMode,
    )
    assert.equal(
      manifest.contributes.configuration.properties["codem.intelligence"].default,
      DEFAULT_PROMPT_SETTINGS.intelligence,
    )
  })
})
