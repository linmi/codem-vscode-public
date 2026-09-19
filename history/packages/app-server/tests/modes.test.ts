import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseAppServerModes, reconcileAppServerModes } from "../src/modes.ts"

const state = { revision: 2, permissionEpoch: 1, permissionMode: "auto", workMode: "normal" } as const
describe("Core thread mode contract", () => {
  it("accepts the three native modes and rejects old or malformed states", () => {
    for (const permissionMode of ["default", "auto", "yolo"])
      assert.equal(
        parseAppServerModes({ threadId: "t", state: { ...state, permissionMode } }, "t").permissionMode,
        permissionMode,
      )
    for (const patch of [
      { permissionMode: true },
      { permissionMode: "acceptEdits" },
      { permissionMode: "unknown" },
      { revision: -1 },
      { revision: 0.5 },
      { revision: Number.MAX_SAFE_INTEGER + 1 },
      { permissionEpoch: -1 },
      { workMode: "default" },
      { enabled: true },
    ])
      assert.throws(() => parseAppServerModes({ threadId: "t", state: { ...state, ...patch } }, "t"))
    assert.throws(() => parseAppServerModes({ threadId: "other", state }, "t"), /thread mismatch/)
    assert.throws(() => parseAppServerModes({ threadId: "t", state, raw: "unexpected" }, "t"))
  })
  it("ignores stale and duplicate snapshots, rejects conflicting revisions and regressing epochs", () => {
    assert.equal(reconcileAppServerModes(state, { ...state }), state)
    assert.equal(reconcileAppServerModes(state, { ...state, revision: 1, permissionMode: "yolo" }), state)
    assert.throws(() => reconcileAppServerModes(state, { ...state, permissionMode: "yolo" }), /conflicting/)
    assert.throws(() => reconcileAppServerModes(state, { ...state, revision: 3, permissionEpoch: 0 }), /backwards/)
    assert.equal(reconcileAppServerModes(state, { ...state, revision: 3 }).revision, 3)
  })
})
