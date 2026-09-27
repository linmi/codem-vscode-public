import assert from "node:assert/strict"
import { it } from "node:test"
import { ViewActionRouter, type ViewActionTargets, type ViewReply } from "../src/chat/viewActionRouter.ts"
import { parseViewAction, type ViewAction } from "../src/shared/messages.ts"
import { UserVisibleError } from "../src/shared/userVisibleError.ts"
import type { PluginSource } from "@codem/app-server"

type Pick = (signal: AbortSignal) => Promise<PluginSource | null>
/** Records every feature call by name; chat methods not overridden resolve to undefined. */
function fixture(options: { signedIn?: boolean; threadId?: string | null; chat?: Record<string, (...args: never[]) => unknown>; features?: Record<string, (...args: never[]) => unknown>; send?: (...args: never[]) => Promise<boolean> } = {}) {
  const calls: string[] = []
  const replies: ViewReply[] = []
  const errors: string[] = []
  const lines: string[] = []
  const picks: Pick[] = []
  const record = (owner: string, overrides: Record<string, (...args: never[]) => unknown> = {}, values: Record<string, unknown> = {}) => new Proxy({}, {
    get: (_target, name: string) => name in values ? values[name] : (...args: unknown[]) => {
      calls.push(`${owner}.${name}(${args.filter(arg => typeof arg !== "function").map(arg => JSON.stringify(arg)).join(", ")})`)
      return overrides[name] ? (overrides[name] as (...args: unknown[]) => unknown)(...args) : undefined
    },
  })
  const targets = {
    account: record("account", { logout: ((endSession: () => Promise<void>) => endSession()) as never }, { signedIn: options.signedIn ?? true }),
    autoConnect: record("autoConnect"),
    chat: record("chat", { currentThreadId: () => options.threadId === undefined ? "thread-1" : options.threadId, installPlugin: ((pick: Pick) => { picks.push(pick) }) as never, ...options.chat }),
    selection: record("selection", { send: options.send ?? (async () => true) }, { state: record("selection.state") }),
    surfaces: record("surfaces"),
    panels: record("panels"),
    features: record("features", options.features),
    sessions: record("sessions"),
    showOutput: () => { calls.push("showOutput()") },
    showError: (message: string) => { errors.push(message) },
    log: (line: string) => { lines.push(line) },
  } as unknown as ViewActionTargets
  const router = new ViewActionRouter(targets)
  const dispatch = (action: ViewAction) => router.dispatch(action, result => { replies.push(result) })
  return { dispatch, calls, replies, errors, lines, picks }
}

it("refuses every non-account action while signed out, still answering the receipts the surface waits for", async () => {
  const f = fixture({ signedIn: false })
  await f.dispatch({ type: "pasteImages", requestId: "paste-1", scope: "scope", images: [] })
  await f.dispatch({ type: "send", text: "hello", requestId: "send-1" })
  await f.dispatch({ type: "stop" })
  await f.dispatch({ type: "searchFiles", query: "a", requestId: "search-1" })
  assert.deepEqual(f.replies, [
    { type: "pasteImagesResult", requestId: "paste-1", error: "请先登录后再粘贴图片。" },
    { type: "sendResult", requestId: "send-1", accepted: false },
  ])
  assert.deepEqual(f.calls, ["account.publish()", "account.publish()", "account.publish()", "account.publish()"], "Refused actions only republish the account")
  f.calls.length = 0
  await f.dispatch({ type: "ready" })
  await f.dispatch({ type: "showOutput" })
  await f.dispatch({ type: "signIn" })
  assert.deepEqual(f.calls, ["account.initialize()", "account.publish()", "autoConnect.run()", "showOutput()", "account.login()"])
})

it("drops thread controls aimed at a thread that is no longer current", async () => {
  const controls = (threadId: string): ViewAction[] => [
    { type: "steer", threadId, text: "more", requestId: "r1" },
    { type: "askSideQuestion", threadId, text: "why", requestId: "r2" },
    { type: "shellCommand", threadId, text: "ls", requestId: "r3" },
    { type: "compactThread", threadId, requestId: "r4" },
    { type: "rewindThread", threadId, requestId: "r5" },
    { type: "clearThread", threadId, requestId: "r6" },
  ]
  for (const current of ["thread-1", null]) {
    const stale = fixture({ threadId: current })
    for (const action of controls("thread-0")) await stale.dispatch(action)
    assert.deepEqual(stale.calls.filter(call => !call.startsWith("chat.currentThreadId")), [], `A stale thread id never reaches the chat (current ${current})`)
  }
  const live = fixture({ threadId: "thread-1" })
  for (const action of controls("thread-1")) await live.dispatch(action)
  assert.deepEqual(live.calls.filter(call => !call.startsWith("chat.currentThreadId")), [
    'chat.steer("more", "r1")', 'chat.askSideQuestion("why", "r2")', 'chat.shellCommand("ls", "r3")',
    'chat.startControl("compact", "r4")', 'chat.startControl("rewind", "r5")', 'chat.manageThread("clear", "thread-1", "", "r6")',
  ])
  const history = fixture({ threadId: "thread-1" })
  await history.dispatch({ type: "manageThread", operation: "archive", threadId: "thread-0", name: "", requestId: "r7" })
  assert.deepEqual(history.calls, ['chat.manageThread("archive", "thread-0", "", "r7")'], "History operations name any listed thread")
})

it("routes queue actions and lets the controller refuse a queue aimed at another thread", async () => {
  const f = fixture({ threadId: "thread-1" })
  await f.dispatch({ type: "queueMessage", threadId: "thread-0", text: "next", requestId: "r1" })
  await f.dispatch({ type: "editQueuedMessage", id: "q-1", text: "changed" })
  await f.dispatch({ type: "removeQueuedMessage", id: "q-1" })
  await f.dispatch({ type: "resumeQueue" })
  assert.deepEqual(f.calls, ['chat.queueMessage("thread-0", "next", "r1")', 'chat.editQueuedMessage("q-1", "changed")', 'chat.removeQueuedMessage("q-1")', "chat.resumeQueue()"])
})

it("answers a failed file search with an empty, retryable result and a failed selection as not accepted", async () => {
  const failed = fixture({ chat: { searchFiles: async () => { throw new Error("/private/path leaked") }, selectFile: async () => { throw new Error("stale handle") } } })
  await failed.dispatch({ type: "searchFiles", query: "main", requestId: "search-1" })
  await failed.dispatch({ type: "selectFile", id: "file-1", requestId: "select-1" })
  assert.deepEqual(failed.replies, [
    { type: "fileSearchResult", requestId: "search-1", files: [], error: "文件搜索失败，请重试。" },
    { type: "fileSelected", requestId: "select-1", accepted: false },
  ])
  const found = fixture({
    chat: { searchFiles: (async (query: string, find: (cwd: string, query: string) => Promise<readonly string[]>) => (await find("/workspace", query)).map(path => ({ id: "file-1", label: path }))) as never, selectFile: async () => true },
    features: { findFiles: async () => ["src/main.ts"] },
  })
  await found.dispatch({ type: "searchFiles", query: "main", requestId: "search-2" })
  await found.dispatch({ type: "selectFile", id: "file-1", requestId: "select-2" })
  assert.deepEqual(found.replies, [
    { type: "fileSearchResult", requestId: "search-2", files: [{ id: "file-1", label: "src/main.ts" }], error: null },
    { type: "fileSelected", requestId: "select-2", accepted: true },
  ])
  assert.ok(found.calls.includes('features.findFiles("/workspace", "main")'), "The Host picker searches in the connection's folder")
})

it("installs only a plugin folder the Host can read locally, and forwards a parsed marketplace spec as is", async () => {
  for (const spec of ["sample", "@local", "sample@", "../escape@local", "sample@local/x", `${"a".repeat(129)}@local`]) {
    assert.throws(() => parseViewAction({ type: "installMarketplacePlugin", spec }), /Unsupported CodeM action/, `An invalid spec never reaches the router: ${spec}`)
  }
  const marketplace = fixture()
  await marketplace.dispatch(parseViewAction({ type: "installMarketplacePlugin", spec: "sample@local" }))
  assert.deepEqual(await marketplace.picks[0]!(new AbortController().signal), { kind: "marketplace", spec: "sample@local" })

  let chosen: readonly { scheme: string; fsPath: string }[] | undefined
  let opened: Promise<void> = Promise.resolve()
  const local = fixture({ features: { pickPluginFolder: async () => { await opened; return chosen } } })
  await local.dispatch({ type: "installLocalPlugin" })
  const pick = local.picks[0]!
  const signal = new AbortController().signal
  chosen = [{ scheme: "vscode-remote", fsPath: "/remote/plugin" }]
  await assert.rejects(pick(signal), (error: unknown) => error instanceof UserVisibleError && error.message === "插件需要可访问的本地文件夹。")
  chosen = undefined
  assert.equal(await pick(signal), null, "Closing the picker is no source")
  chosen = []
  assert.equal(await pick(signal), null)
  chosen = [{ scheme: "file", fsPath: "/plugins/sample" }]
  assert.deepEqual(await pick(signal), { kind: "local", path: "/plugins/sample" })
  const cancel = new AbortController()
  let close!: () => void
  opened = new Promise(resolve => { close = resolve })
  const pending = pick(cancel.signal)
  cancel.abort(); close()
  await assert.rejects(pending, { name: "AbortError" }, "A folder chosen after cancellation is ignored")
})

it("reports why a send with selected code failed and answers without accepting", async () => {
  const failed = fixture({ send: async () => { throw new Error("选区已变化，请重新选择。") } })
  await failed.dispatch({ type: "send", text: "explain", requestId: "send-1", selectionIds: ["selection-1"] })
  assert.deepEqual(failed.errors, ["选区已变化，请重新选择。"])
  assert.deepEqual(failed.replies, [{ type: "sendResult", requestId: "send-1", accepted: false }])
  const opaque = fixture({ send: async () => { throw "not an error" } })
  await opaque.dispatch({ type: "send", text: "explain", requestId: "send-2" })
  assert.deepEqual(opaque.errors, ["无法附带选中代码，请重新选择后重试。"])
  const sent = fixture({ send: (async (text: string, ids: readonly string[] | undefined, send: (text: string) => Promise<boolean>) => send(`${text} ${ids?.join(",")}`)) as never, chat: { send: async () => true } })
  await sent.dispatch({ type: "send", text: "explain", requestId: "send-3", selectionIds: ["selection-1"] })
  assert.deepEqual(sent.replies, [{ type: "sendResult", requestId: "send-3", accepted: true }])
  assert.ok(sent.calls.includes('chat.send("explain selection-1")'))
})

it("signs out by retiring panels, selections, the draft and the auto-connect attempt before resetting the chat", async () => {
  const f = fixture()
  await f.dispatch({ type: "signOut" })
  assert.deepEqual(f.calls, ["account.logout()", "panels.cancel()", "selection.state.clear()", "surfaces.resetDraft()", "autoConnect.reset()", "chat.resetAccount()"])
  assert.match(f.lines[0]!, /^Account disconnect: \d+ms$/)
  const failing = fixture({ chat: { resetAccount: async () => { throw new Error("cleanup failed") } } })
  await assert.rejects(failing.dispatch({ type: "signOut" }), /cleanup failed/, "The account owner sees the failed cleanup")
  assert.match(failing.lines[0]!, /^Account disconnect: \d+ms$/, "The disconnect is timed even when it fails")
})

it("hands the chosen space, the send key and the output channel to their owners", async () => {
  const f = fixture({ chat: { chooseSpace: (async (id: string, open: (session: unknown, key: string, signal: AbortSignal) => Promise<unknown>) => { await open({ cwd: "/workspace" }, `key-${id}`, new AbortController().signal) }) as never } })
  await f.dispatch({ type: "chooseSpace", id: "space-1" })
  await f.dispatch({ type: "setSendKey", sendKey: "ctrlEnter" })
  await f.dispatch({ type: "showOutput" })
  for (const type of ["composerChanged", "setTheme", "pinSelection"] as const) await f.dispatch(type === "setTheme" ? { type, theme: "dark" } : type === "composerChanged" ? { type, value: { draft: "" } } : { type })
  assert.deepEqual(f.calls, ['chat.chooseSpace("space-1")', 'sessions.reopen({"cwd":"/workspace"}, "key-space-1", {})', 'surfaces.saveSendKey("ctrlEnter")', "showOutput()"])
})
