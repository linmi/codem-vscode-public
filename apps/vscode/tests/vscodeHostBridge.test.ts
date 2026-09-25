import { catalogKinds } from "@codem/protocol"
import { parseUiAction } from "../../../packages/ui/src/contract.ts"
import { parseViewAction } from "../src/shared/messages.ts"
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { draftRetention } from "../../../packages/ui/src/chat/draftRetention.ts"
import { VscodeHostBridge } from "../webview/host/vscodeHostBridge.ts"

describe("VS Code host bridge", () => {
  it("projects panels, selections and diffs without file paths", () => {
    const bridge = new VscodeHostBridge()
    bridge.receive({
      type: "state",
      phase: "running",
      workspace: "/Users/linmi/secret/codem-plugin",
      space: "研发团队",
      threadId: "thread-1",
      notice: null,
      diffs: [{ id: "diff-1", label: "/Users/linmi/secret/src/app.ts", added: 2, removed: 1, preview: "raw-partial", available: true }],
      background: [{ id: "term-1", label: "后台进程 1", inProgress: true }],
      history: { open: true, loading: false, entries: [{ id: "thread-1", title: "整理登录页面", archived: false }], hasMore: false, error: null },
    })
    bridge.receive({
      type: "panel",
      panel: {
        id: "panel-1",
        kind: "approval",
        title: "允许运行命令",
        description: "将执行本地命令",
        detail: "npm test",
        choices: [{ id: "allow-once", label: "允许一次", description: "" }],
        allowText: false,
        multiple: false,
      },
    })
    const update = bridge.receive({
      type: "codeSelection",
      value: {
        current: { id: "sel-1", label: "app.ts", path: "/Users/linmi/secret/src/app.ts", startLine: 4, endLine: 8, error: null },
        pinned: [],
      },
    })
    const snapshot = update?.snapshot
    assert.ok(snapshot)
    assert.equal(snapshot.pendingPanel?.title, "允许运行命令")
    assert.equal(snapshot.pendingPanel?.detail, "npm test")
    assert.equal(snapshot.selections[0]?.label, "app.ts")
    assert.equal(snapshot.selections[0]?.pinned, false)
    assert.equal(snapshot.diffs[0]?.label, "app.ts")
    assert.equal(snapshot.diffs[0]?.preview, "raw-partial")
    assert.equal(snapshot.workspace, "codem-plugin")
    assert.equal(snapshot.history.open, true)
    assert.equal(JSON.stringify(snapshot).includes("/Users/linmi/secret"), false)
    assert.equal(snapshot.version > 0, true)
  })

  it("turns every Host showAccount into a new account request without owning the page", () => {
    const bridge = new VscodeHostBridge()
    const signedIn = { status: "signedIn", profile: { avatar: { kind: "none" }, displayName: "林晓", userId: "user", tenantId: null, authMethod: "browser" }, refreshing: false, notice: null }
    assert.equal(bridge.receive({ type: "account", state: signedIn })!.snapshot.accountRequest, 0)
    const first = bridge.receive({ type: "showAccount" })!.snapshot
    assert.equal(first.accountRequest, 1)
    // 返回聊天只改界面状态，不经过 Host；再次请求必须换一个序号，界面才能再次打开。
    const second = bridge.receive({ type: "showAccount" })!.snapshot
    assert.equal(second.accountRequest, 2)
    assert.equal(second.version > first.version, true)
    const signedOut = bridge.receive({ type: "account", state: { status: "signedOut", notice: null } })!.snapshot
    const again = bridge.receive({ type: "account", state: signedIn })!.snapshot
    assert.equal(signedOut.accountRequest, 2)
    assert.equal(again.accountRequest, 2, "Signing back in must not replay an old request")
    assert.equal("accountOpen" in again, false)
  })

  it("ignores notices and restores only explicitly rejected requests", () => {
    const bridge = new VscodeHostBridge()
    const ready = bridge.receive({ type: "state", phase: "ready", threadId: "thread-1", notice: null })!
    const pending = { requestId: "req-1", text: "写一段说明" }
    const failed = bridge.receive({ type: "state", phase: "ready", threadId: "thread-1", notice: "发送未能确认，请检查会话后再重试；未自动重发。" })!
    assert.equal(failed.snapshot.version > ready.snapshot.version, true)
    assert.deepEqual(draftRetention(pending, failed.snapshot, ""), { kind: "waiting" })
    const rejected = bridge.receive({ type: "sendResult", requestId: "req-2", accepted: false })!
    assert.deepEqual(
      draftRetention({ requestId: "req-2", text: "另一条" }, rejected.snapshot, ""),
      { kind: "restore", text: "另一条" },
    )
  })

  it("appends editor context and reports an overlong draft without dropping the original", () => {
    const bridge = new VscodeHostBridge()
    bridge.rememberDraft("已有草稿")
    const added = bridge.receive({ type: "appendContext", id: "ctx-1", text: "参考以下代码" })
    assert.equal(added?.draft?.text, "已有草稿\n\n参考以下代码")
    assert.equal(added?.reply?.accepted, true)
    bridge.rememberDraft("x".repeat(32_000))
    const rejected = bridge.receive({ type: "appendContext", id: "ctx-2", text: "再加一段" })
    assert.equal(rejected?.reply?.accepted, false)
    assert.ok(rejected?.reply)
    assert.equal((rejected.reply.value as { draft: string }).draft.length, 32_000)
    assert.equal(rejected?.draft, undefined)
  })

  it("translates selection, paste and send-key actions into the VS Code host contract", () => {
    const bridge = new VscodeHostBridge()
    bridge.receive({
      type: "state",
      phase: "ready",
      workspace: "codem-plugin",
      space: "研发团队",
      threadId: "thread-1",
    })
    bridge.receive({
      type: "codeSelection",
      value: { current: { id: "sel-1", label: "app.ts", path: "/tmp/app.ts", startLine: 1, endLine: 2, error: null }, pinned: [] },
    })
    assert.deepEqual(bridge.toHost({ type: "pinSelection" }), { type: "pinCodeSelection", id: "sel-1" })
    assert.deepEqual(bridge.toHost({ type: "removeSelection", id: "sel-1" }), { type: "removeCodeSelection", id: "sel-1" })
    const paste = bridge.toHost({ type: "pasteImages", requestId: "req-1", images: [] })
    assert.equal(paste.scope, JSON.stringify(["codem-plugin", "研发团队", "thread-1"]))
    assert.deepEqual(bridge.toHost({ type: "setSendKey", sendKey: "modEnter" }), { type: "setSendKey", sendKey: "ctrlEnter" })
    assert.equal(bridge.receive({ type: "editorSettings", sendKey: "ctrlEnter" })?.snapshot.sendKey, "modEnter")
    const sent = bridge.toHost({ type: "send", text: "你好", requestId: "req-2", selectionIds: ["sel-1"], attachmentIds: ["file-1"] })
    assert.deepEqual(sent, { type: "send", text: "你好", requestId: "req-2", selectionIds: ["sel-1"] })
  })
})


it("every displayed catalog crosses the shared UI, bridge and Host validation unchanged", () => {
  const bridge = new VscodeHostBridge()
  for (const kind of catalogKinds) {
    const action = { type: "loadCatalog", kind }
    assert.deepEqual(parseViewAction(bridge.toHost(parseUiAction(action))), action)
  }
  assert.throws(() => parseViewAction({ type: "loadCatalog", kind: "secrets" }))
  assert.throws(() => parseUiAction({ type: "loadCatalog", kind: "tools", path: "/tmp" }))
})
