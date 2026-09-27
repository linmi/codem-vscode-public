import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"
import { asSnapshot, initialSnapshot, isPluginSpec, isSignedIn, isThreadOperation, parseUiAction, visibleControls } from "../src/contract.ts"
import { welcomeState } from "../src/chat/welcomeState.ts"
import { lastActivityId, timelineGroups, workGroupState } from "../src/chat/timelineGroups.ts"
import { activityTitle } from "../src/chat/toolPresentation.ts"
import { workingStatus } from "../src/chat/workingStatus.ts"
import { builtinSlashCommands, commandUnavailable, slashQuery } from "../src/chat/slashCommands.ts"
import { draftRetention } from "../src/chat/draftRetention.ts"
import { activeMention, composerMessageAction, inputModeText, mentionQuery, mentionResults, nextMentionSession, sendOnEnter, stepMention } from "../src/chat/composerInput.ts"
import type { FileSearch } from "../src/contract.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

describe("@codem/ui host contract", () => {
  it("accepts and rejects the shared webview samples", async () => {
    const send = JSON.parse(await readFile(join(root, "../contracts/webview/sendAction.json"), "utf8")) as {
      cases: { name: string; input: unknown; expected: { kind: string } }[]
    }
    for (const testCase of send.cases) {
      if (testCase.expected.kind === "accepted") parseUiAction(testCase.input)
      else assert.throws(() => parseUiAction(testCase.input), /Invalid CodeM action|Unsupported/, testCase.name)
    }
  })

  it("shows one loading row until thinking or tool progress exists", () => {
    const base = initialSnapshot()
    assert.deepEqual(workingStatus({ ...base, phase: "sending", messages: [] }), { label: "正在思考与处理…", animate: true })
    assert.deepEqual(workingStatus({ ...base, phase: "connecting", messages: [] }), { label: "正在思考与处理…", animate: true })
    assert.deepEqual(
      workingStatus({
        ...base,
        phase: "running",
        pendingPanel: { id: "approval-1", kind: "approval", title: "需要审批", description: "", detail: null, choices: [], allowText: false, multiple: false, backChoiceId: null, initialText: "", confirmLabel: null },
        messages: [{ id: "user", role: "user", text: "改一下" }],
      }),
      { label: "等待你的批准…", animate: false },
    )
    assert.equal(
      workingStatus({
        ...base,
        phase: "running",
        messages: [
          { id: "user", role: "user", text: "改一下" },
          { id: "think", role: "reasoning", text: "", summary: "正在分析实现方案", status: "running" },
        ],
      }),
      null,
    )
  })

  it("sends a follow-up while a turn is running and does not consult background processes", () => {
    assert.equal(composerMessageAction("running", false), "steer")
    for (const queueable of [false, true]) {
      assert.equal(composerMessageAction("ready", queueable), "send")
      assert.equal(composerMessageAction("disconnected", queueable), "send")
      assert.equal(composerMessageAction("sending", queueable), "none")
      assert.equal(composerMessageAction("stopping", queueable), "none")
    }
  })

  it("queues a running follow-up when the host keeps a message queue", () => {
    assert.equal(composerMessageAction("running", true), "queue")
  })

  it("names the mode bar, field, placeholder and send button from one table per input mode", () => {
    assert.deepEqual(inputModeText("message"), { label: "", hint: "", placeholder: "提出问题，或输入 / 选择会话操作…", field: "发送给 CodeM 的消息", submit: "发送消息" })
    assert.deepEqual(inputModeText("steer"), { label: "补充指令", hint: "补充当前任务的执行方向。", placeholder: "输入补充指令…", field: "补充指令输入", submit: "发送补充指令" })
    assert.deepEqual(inputModeText("askSideQuestion"), { label: "旁路提问", hint: "单独提问，回答显示在这里。", placeholder: "输入旁路提问…", field: "旁路提问输入", submit: "发送旁路提问" })
    assert.deepEqual(inputModeText("shellCommand"), { label: "Shell 命令", hint: "发送前会展示命令并请求确认。", placeholder: "输入要执行的命令…", field: "Shell 命令输入", submit: "检查命令" })
  })

  it("names the prompt after its input mode so a mode switch is announced", () => {
    // 迁入 @codem/ui 时三种能力输入都成了“会话命令输入”；原 Webview 按模式命名，浏览器检查也按这些名称找输入框。
    for (const mode of ["steer", "askSideQuestion", "shellCommand"] as const) assert.equal(inputModeText(mode).field, `${inputModeText(mode).label}输入`, mode)
    const fields = (["message", "steer", "askSideQuestion", "shellCommand"] as const).map((mode) => inputModeText(mode).field)
    assert.equal(new Set(fields).size, fields.length, `prompt names must differ per mode: ${fields.join(", ")}`)
  })

  it("names the send button after the request each mode posts, never another mode's", () => {
    // 补充指令发 steer，旁路提问发 askSideQuestion：按钮名称跟着各自的模式走。
    for (const mode of ["steer", "askSideQuestion"] as const) assert.equal(inputModeText(mode).submit, `发送${inputModeText(mode).label}`, mode)
    const names = (["message", "steer", "askSideQuestion", "shellCommand"] as const).map((mode) => inputModeText(mode).submit)
    assert.equal(new Set(names).size, names.length, `send button names must differ per mode: ${names.join(", ")}`)
  })

  it("mentions files at the caret and sends on the configured enter key", () => {
    assert.deepEqual(mentionQuery("see @src/App", 12), { query: "src/App", start: 4 })
    assert.equal(mentionQuery("邮件 a@b.com", 10), null)
    assert.equal(sendOnEnter("enter", false, false, false), true)
    assert.equal(sendOnEnter("enter", false, true, false), false)
    assert.equal(sendOnEnter("modEnter", false, true, false), true)
    assert.equal(sendOnEnter("modEnter", true, true, false), false)
    parseUiAction({ type: "searchFiles", query: "App", requestId: "mention-1" })
    parseUiAction({ type: "selectFile", id: "file-1", requestId: "pick-1" })
    parseUiAction({ type: "setSendKey", sendKey: "modEnter" })
    parseUiAction({ type: "closeHistory" })
    parseUiAction({ type: "removeSelection", id: "sel-current" })
  })

  it("keeps showing a mention's previous results until the next search answers, and nothing else", () => {
    const results = (requestId: string, files: string[], status: FileSearch["status"] = files.length ? "ready" : "empty"): FileSearch =>
      ({ requestId, status, files: files.map((id) => ({ id, label: `src/${id}.ts` })), error: null })
    let session = nextMentionSession(null, "mention-1", undefined)
    assert.equal(mentionResults(results("mention-1", ["a"]), session)?.requestId, "mention-1")
    // 下一个字：mention-1 的结果已到，新结果到达前继续显示它，菜单不收起。
    session = nextMentionSession(session, "mention-2", "mention-1")
    assert.equal(mentionResults(results("mention-1", ["a"]), session)?.requestId, "mention-1")
    assert.equal(mentionResults(results("mention-2", ["b"]), session)?.requestId, "mention-2")
    // 连续快打：mention-3 还没发出就被 mention-4 取代，继续显示的仍是 mention-2。
    session = nextMentionSession(nextMentionSession(session, "mention-3", "mention-2"), "mention-4", "mention-2")
    assert.deepEqual(session, { request: "mention-4", previous: "mention-2" })
    // 不是本次提及发出的请求、Host 清空结果、收起后，都不显示。
    assert.equal(mentionResults(results("mention-1", ["a"]), session), null)
    assert.equal(mentionResults(null, session), null)
    assert.equal(mentionResults(results("mention-4", ["a"]), null), null)
    // 没有文件且不在搜索、也没有错误时不留空框；搜索中和出错时显示状态。
    assert.equal(mentionResults(results("mention-4", []), session), null)
    assert.equal(mentionResults(results("mention-4", [], "loading"), session)?.status, "loading")
    assert.equal(mentionResults({ ...results("mention-4", [], "error"), error: "文件搜索失败，请重试。" }, session)?.error, "文件搜索失败，请重试。")
  })

  it("resets the highlighted mention when the results change and wraps arrow keys", () => {
    const first = { requestId: "mention-1", status: "ready" as const, files: [{ id: "a", label: "a.ts" }, { id: "b", label: "b.ts" }, { id: "c", label: "c.ts" }], error: null }
    assert.equal(activeMention(first, null), "a")
    assert.equal(activeMention(first, { requestId: "mention-1", id: "c" }), "c")
    // 新一批结果：上一批的高亮不再作数，即使同名文件还在。
    const next = { ...first, requestId: "mention-2", files: [{ id: "d", label: "d.ts" }, { id: "c", label: "c.ts" }] }
    assert.equal(activeMention(next, { requestId: "mention-1", id: "c" }), "d")
    assert.equal(activeMention(next, { requestId: "mention-2", id: "c" }), "c")
    assert.equal(activeMention(next, { requestId: "mention-2", id: "gone" }), "d")
    assert.equal(activeMention({ ...next, files: [] }, { requestId: "mention-2", id: "c" }), null)
    assert.equal(activeMention(null, null), null)
    assert.equal(stepMention(first.files, "c", 1), "a")
    assert.equal(stepMention(first.files, "a", -1), "c")
    assert.equal(stepMention(first.files, "a", 1), "b")
    assert.equal(stepMention(first.files, "gone", 1), "a")
    assert.equal(stepMention([], null, 1), null)
  })

  it("waits for explicit receipts even after optimistic messages and unrelated notices", () => {
    const pending = { requestId: "req-1", text: "  写一段说明\n" }
    const base = initialSnapshot()
    const optimistic = {
      ...base,
      version: 5,
      messages: [{ id: "req-1", role: "user" as const, text: "写一段说明" }],
    }
    for (const snapshot of [optimistic, { ...optimistic, notice: "Connecting" }, {
      ...optimistic, submission: { requestId: "another", accepted: true },
    }]) {
      assert.deepEqual(draftRetention(pending, asSnapshot(snapshot)!, pending.text), { kind: "waiting" })
    }
    const rejected = { ...optimistic, submission: { requestId: "req-1", accepted: false } }
    assert.deepEqual(draftRetention(pending, asSnapshot(rejected)!, pending.text), { kind: "restore", text: pending.text })
    assert.deepEqual(draftRetention(pending, asSnapshot(rejected)!, ""), { kind: "restore", text: pending.text })
    assert.deepEqual(draftRetention(pending, asSnapshot(rejected)!, "新的输入"), { kind: "preserve" })
    const confirmed = { ...base, submission: { requestId: "req-1", accepted: true } }
    assert.deepEqual(draftRetention(pending, asSnapshot(confirmed)!, pending.text), { kind: "accepted" })
  })

  it("accepts capability actions used by both hosts", () => {
    parseUiAction({ type: "setWorkMode", workMode: "plan" })
    parseUiAction({ type: "setPermission", permission: "auto" })
    parseUiAction({ type: "setEffort", effort: "high" })
    parseUiAction({ type: "setTheme", theme: "dark" })
    parseUiAction({ type: "chooseModel", id: "demo-model" })
    parseUiAction({ type: "resumeThread", threadId: "thread-old" })
    parseUiAction({ type: "olderMessages" })
    parseUiAction({ type: "send", text: "hello", requestId: "req-1", skillName: "review" })
    parseUiAction({ type: "send", text: "hello", requestId: "req-1", attachmentIds: ["file-1"], selectionIds: ["sel-1"] })
    parseUiAction({ type: "loadCatalog", kind: "environment" })
    parseUiAction({ type: "loadCatalog", kind: "tools" })
    parseUiAction({ type: "panelReply", id: "interaction-42", choiceIds: ["allow-once"], text: "", cancelled: false })
    parseUiAction({ type: "manageThread", operation: "fork", threadId: "thread-1", name: "", requestId: "req-2" })
    parseUiAction({ type: "showHistory" })
    parseUiAction({ type: "signIn" })
    parseUiAction({ type: "signOut" })
    parseUiAction({ type: "refreshAccount" })
    assert.throws(() => parseUiAction({ type: "send", text: "hello", requestId: "req-1", skillName: "review", attachmentIds: ["file-1"] }))
    assert.throws(() => parseUiAction({ type: "setWorkMode", workMode: "normal" }))
    assert.throws(() => parseUiAction({ type: "addDirectory", path: "/etc" }))
  })

  it("uses one thread operation list for validation, slash routing and the confirm panel", () => {
    for (const operation of ["rename", "fork", "archive", "unarchive", "delete"]) {
      assert.equal(isThreadOperation(operation), true, operation)
      assert.ok(builtinSlashCommands.some((command) => command.id === operation), operation)
      parseUiAction({ type: "manageThread", operation, threadId: "thread-1", name: operation === "rename" ? "新名字" : "", requestId: "req-1" })
    }
    for (const value of ["clear", "compact", "Rename", "", null, ["rename"]]) {
      assert.equal(isThreadOperation(value), false, String(value))
      assert.throws(() => parseUiAction({ type: "manageThread", operation: value, threadId: "thread-1", name: "", requestId: "req-1" }), /Invalid CodeM action/u, String(value))
    }
  })

  it("does not import Node, app-server, history or editor hosts", async () => {
    const source = [
      await readFile(join(root, "src/mount.tsx"), "utf8"),
      await readFile(join(root, "src/chat/ChatApp.tsx"), "utf8"),
      await readFile(join(root, "src/chat/markdownSafety.ts"), "utf8"),
      await readFile(join(root, "src/chat/SafeMarkdown.tsx"), "utf8"),
      await readFile(join(root, "src/chat/MessageList.tsx"), "utf8"),
      await readFile(join(root, "src/chat/AccountPage.tsx"), "utf8"),
      await readFile(join(root, "src/chat/SlashMenu.tsx"), "utf8"),
      await readFile(join(root, "src/chat/WelcomeView.tsx"), "utf8"),
      await readFile(join(root, "src/chat/welcomeState.ts"), "utf8"),
      await readFile(join(root, "src/chat/composerMenus.tsx"), "utf8"),
      await readFile(join(root, "src/contract.ts"), "utf8"),
    ].join("\n")
    assert.doesNotMatch(source, /from ["']node:|@codem\/app-server|@codem\/history|acquireVsCodeApi|com\.intellij/u)
    assert.doesNotMatch(source, /approval-1/u)
    assert.doesNotMatch(source, /完整 Markdown transcript|listLiveThreadTurns|listLiveThreadItems/u)
    assert.match(source, /data-testid="messages"/u)
    assert.match(source, /我们一起做点什么/u)
    assert.match(source, /sessionHeader|composerToolbar|accountPage|slashMenu/u)
    assert.match(source, /正在检查登录状态/u)
    assert.match(source, /workGroup/u)
    assert.doesNotMatch(source, /data-testid="transcript"/u)
    assert.doesNotMatch(source, /连接后发送消息|codemCapabilities|CapabilityPanel|selectTheme|data-testid="connect"/u)
    assert.doesNotMatch(source, /<p>\{(?:message\.text|snapshot\.assistantText)\}<\/p>/u)
  })

  it("shows retry, resume and older entries only when the Host flags and state agree", () => {
    const hidden = { retry: false, resume: false, older: false }
    const base = { phase: "ready" as const, threadId: null, resumeThreadId: null, canRetry: false, canResume: false, canLoadOlder: false }
    assert.deepEqual(visibleControls(initialSnapshot()), hidden)
    // JetBrains 用 failed，VS Code 用带提示的 disconnected；连接中或已就绪时残留的 canRetry 不出重试。
    assert.equal(visibleControls({ ...base, phase: "failed", canRetry: true }).retry, true)
    assert.equal(visibleControls({ ...base, phase: "disconnected", canRetry: true }).retry, true)
    for (const phase of ["connecting", "ready", "closing"] as const) assert.equal(visibleControls({ ...base, phase, canRetry: true }).retry, false, phase)
    assert.equal(visibleControls({ ...base, phase: "failed" }).retry, false)
    // 恢复必须有可恢复的会话，且当前没有打开的会话；更早消息必须属于当前会话。
    assert.equal(visibleControls({ ...base, canResume: true, resumeThreadId: "thread-old" }).resume, true)
    assert.equal(visibleControls({ ...base, canResume: true }).resume, false)
    assert.equal(visibleControls({ ...base, canResume: true, resumeThreadId: "thread-old", threadId: "thread-1" }).resume, false)
    assert.equal(visibleControls({ ...base, canLoadOlder: true, threadId: "thread-1" }).older, true)
    assert.equal(visibleControls({ ...base, canLoadOlder: true }).older, false)
    assert.deepEqual(visibleControls({ ...base, threadId: "thread-1", resumeThreadId: "thread-old" }), hidden)
  })

  it("groups thinking and tools into work disclosures and keeps the final reply outside", () => {
    const messages = [
      { id: "u1", role: "user" as const, text: "查一下", turnId: "t1" },
      { id: "r1", role: "reasoning" as const, text: "先搜索", status: "completed" as const, turnId: "t1" },
      { id: "p1", role: "assistant" as const, text: "正在搜索…", turnId: "t1" },
      { id: "tool1", role: "tool" as const, text: "ok", status: "completed" as const, label: "grep", turnId: "t1" },
      { id: "a1", role: "assistant" as const, text: "最终答复", turnId: "t1" },
    ]
    const groups = timelineGroups(messages)
    assert.equal(groups.filter((group) => group.kind === "work").length, 1)
    assert.equal(groups.at(-1)?.kind, "message")
    if (groups[1]?.kind === "work") {
      assert.equal(workGroupState(groups[1].messages, groups[1].id, lastActivityId(messages), "ready", groups[1].hasResult), "completed")
      assert.equal(groups[1].hasResult, true)
    }
    assert.equal(activityTitle(messages[3]!), "已搜索内容")
  })

  it("keeps a mid-turn work heading before tools arrive and leaves the final reply outside", () => {
    const sending = { ...initialSnapshot(), phase: "sending" as const, messages: [{ id: "u1", role: "user" as const, text: "查一下", turnId: "t1" }] }
    assert.equal(sending.phase, "sending")
    assert.equal(lastActivityId(sending.messages), null)
  })

  it("opens slash from local catalog and never treats opening as a Host action", () => {
    assert.equal(slashQuery("/"), "")
    assert.equal(slashQuery("/hi"), "hi")
    assert.equal(slashQuery("/hi world"), null)
    const ready = { ...initialSnapshot(), phase: "ready" as const, threadId: "thread-1" }
    assert.equal(commandUnavailable("history", ready), null)
    assert.equal(commandUnavailable("steer", { ...ready, phase: "ready" }), "主任务运行时可补充指令")
    parseUiAction({ type: "showHistory" })
  })

  it("keeps the shared product styles aligned with the VS Code shell", async () => {
    const css = [
      await readFile(join(root, "src/styles/synaraTokens.css"), "utf8"),
      await readFile(join(root, "src/styles/product.css"), "utf8"),
      await readFile(join(root, "src/styles/account.css"), "utf8"),
      await readFile(join(root, "src/styles/shadcnStyles.css"), "utf8"),
    ].join("\n")
    assert.match(css, /--composerRadius: 19.2px/u)
    assert.match(css, /\.sendButton/u)
    assert.match(css, /\.sessionHeader/u)
    assert.match(css, /backdrop-filter: blur\(40px\)/u)
    assert.match(css, /\.composerCatalogMenu/u)
    assert.doesNotMatch(css, /#efe6d8|#f5c518/u)
  })

  it("keeps welcome static until a real connection and hides it after messages", () => {
    assert.deepEqual(welcomeState("disconnected", false, false, "idle"), { visible: true, motion: "idle" })
    assert.deepEqual(welcomeState("connecting", false, false, "idle"), { visible: true, motion: "initializing" })
    assert.deepEqual(welcomeState("ready", false, false, "initializing"), { visible: true, motion: "settled" })
    assert.deepEqual(welcomeState("disconnected", true, false, "initializing"), { visible: false, motion: "idle" })
  })

  it("normalizes vscode-shaped account and activity messages without exposing raw paths", () => {
    const snapshot = asSnapshot({
      type: "state",
      phase: "ready",
      account: { status: "signedIn", refreshing: false, notice: null, profile: { displayName: "林晓", userId: "u1", tenantId: "t1", authMethod: "browser", avatar: { kind: "none" } } },
      messages: [
        { id: "tool", role: "tool", text: "out", status: "completed", label: "read_files", details: { kind: "file", fields: [{ label: "文件", value: "src/main.ts" }], code: null } },
      ],
    })
    assert.ok(snapshot)
    assert.equal(isSignedIn(snapshot.account), true)
    assert.equal(snapshot.messages[0]?.details?.fields[0]?.value, "src/main.ts")
    assert.equal(initialSnapshot().account.status, "checking")
  })

  it("reuses the view of a deeply frozen message and normalizes anything else every time", () => {
    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value)
        for (const item of Object.values(value)) deepFreeze(item)
      }
      return value
    }
    const frozen = deepFreeze({ id: "a", role: "tool", label: "run_bash", text: "ok", summary: "", status: "completed", details: { kind: "command", fields: [{ label: "目录", value: "workspace" }], code: null } })
    const snapshot = (messages: unknown[]) => asSnapshot({ type: "state", messages })!.messages
    const [first] = snapshot([frozen]), [second] = snapshot([frozen])
    assert.equal(second, first, "An unchanged frozen message keeps its view")
    assert.equal(Object.isFrozen(first) && Object.isFrozen(first!.details!.fields[0]), true, "A shared view is frozen")
    assert.deepEqual(first, snapshot([structuredClone(frozen)])[0], "Reuse gives exactly what normalizing a copy gives")

    const mutable = structuredClone(frozen)
    const [one] = snapshot([mutable]), [two] = snapshot([mutable])
    assert.notEqual(one, two, "Mutable input is normalized again")
    assert.equal(Object.isFrozen(one), false)
    const shallow = Object.freeze({ ...structuredClone(frozen) })
    assert.notEqual(snapshot([shallow])[0], snapshot([shallow])[0], "A message with mutable parts is not reused")
    const unknown = deepFreeze({ id: "b", role: "system", text: "hidden" })
    assert.deepEqual([snapshot([unknown]), snapshot([unknown])], [[], []], "An unknown role stays dropped")
  })

  it("carries Host account-page requests as a counter, never as open state", () => {
    assert.equal(initialSnapshot().accountRequest, 0)
    assert.equal("accountOpen" in initialSnapshot(), false)
    assert.equal(asSnapshot({ type: "state", accountRequest: 3 })?.accountRequest, 3)
    assert.equal("accountOpen" in asSnapshot({ type: "state", accountOpen: true })!, false)
    for (const accountRequest of [-1, 1.5, Number.NaN, "2", true, null]) {
      assert.equal(asSnapshot({ type: "state", accountRequest })?.accountRequest, 0, String(accountRequest))
    }
  })
})

it("accepts bounded body search intents and hides unsupported search before host state", () => {
  assert.equal(initialSnapshot().conversationSearch, null)
  for (const type of ["showConversationSearch", "closeConversationSearch"]) assert.deepEqual(parseUiAction({ type }), { type })
  assert.deepEqual(parseUiAction({ type: "searchConversation", query: "needle" }), { type: "searchConversation", query: "needle" })
  assert.throws(() => parseUiAction({ type: "searchConversation", query: " " }))
  assert.throws(() => parseUiAction({ type: "searchConversation", query: "x".repeat(513) }))
  assert.throws(() => parseUiAction({ type: "searchConversation", query: "needle", path: "/secret" }))
  assert.throws(() => parseUiAction({ type: "selectConversationSearchHit", id: "../secret" }))
})

it("validates plugin management intents and strips Host-only installation metadata", () => {
  assert.equal(initialSnapshot().pluginManagement, null)
  assert.deepEqual(parseUiAction({ type: "installMarketplacePlugin", spec: "sample@local" }), { type: "installMarketplacePlugin", spec: "sample@local" })
  assert.throws(() => parseUiAction({ type: "installMarketplacePlugin", spec: "./private/path" }))
  // 安装按钮和动作校验共用 isPluginSpec：两边对同一输入给出同一结论。
  const name = `a${"b".repeat(127)}`
  for (const spec of ["sample@local", "my.plugin_1-x@team-market", `${name}@${name}`]) {
    assert.equal(isPluginSpec(spec), true, spec)
    assert.deepEqual(parseUiAction({ type: "installMarketplacePlugin", spec }), { type: "installMarketplacePlugin", spec })
  }
  for (const spec of ["sample", "@local", "sample@", "-sample@local", "sample@local@x", "sample @local", ` sample@local`, `${name}b@local`, "插件@local", 42, null]) {
    assert.equal(isPluginSpec(spec), false, String(spec))
    assert.throws(() => parseUiAction({ type: "installMarketplacePlugin", spec }), /Invalid CodeM action|Unsupported/u, String(spec))
  }
  assert.throws(() => parseUiAction({ type: "installLocalPlugin", path: "/private" }))
  assert.throws(() => parseUiAction({ type: "changePlugin", action: "delete-source", id: "sample" }))
  assert.throws(() => parseUiAction({ type: "changePlugin", action: "uninstall", id: "sample@local" }))
  const snapshot = asSnapshot({ type: "state", pluginManagement: { open: true, status: "ready", loaded: true, entries: [{ id: "opaque-1", name: "sample", version: "1.0", enabled: false, path: "/private/source", key: "sample@market" }], skills: [] } })!
  assert.equal(snapshot.pluginManagement!.entries[0]!.enabled, false)
  assert.doesNotMatch(JSON.stringify(snapshot.pluginManagement), /private|path|sample@market/)
})

it("validates queue actions and bounds the queue the Host reports", () => {
  assert.deepEqual(parseUiAction({ type: "queueMessage", threadId: "thread-1", text: "next", requestId: "req-1" }), { type: "queueMessage", threadId: "thread-1", text: "next", requestId: "req-1" })
  assert.deepEqual(parseUiAction({ type: "editQueuedMessage", id: "queued-1", text: "changed" }), { type: "editQueuedMessage", id: "queued-1", text: "changed" })
  assert.deepEqual(parseUiAction({ type: "removeQueuedMessage", id: "queued-1" }), { type: "removeQueuedMessage", id: "queued-1" })
  assert.deepEqual(parseUiAction({ type: "resumeQueue" }), { type: "resumeQueue" })
  for (const bad of [
    { type: "queueMessage", text: "next", requestId: "req-1" },
    { type: "queueMessage", threadId: "thread-1", text: "  ", requestId: "req-1" },
    { type: "editQueuedMessage", id: "queued-1", text: "" },
    { type: "editQueuedMessage", id: "../queued", text: "changed" },
    { type: "resumeQueue", id: "queued-1" },
  ]) assert.throws(() => parseUiAction(bad), JSON.stringify(bad))
  assert.equal(asSnapshot({ type: "state" })!.messageQueue, null)
  const items = Array.from({ length: 25 }, (_, index) => ({ id: `queued-${index}`, text: `message ${index}` }))
  const queue = asSnapshot({ type: "state", messageQueue: { items: [{ id: "bad id", text: "x" }, { id: "empty", text: " " }, ...items], paused: true } })!.messageQueue!
  assert.equal(queue.items.length, 20)
  assert.equal(queue.items[0]!.id, "queued-0")
  assert.equal(queue.paused, true)
  assert.equal(asSnapshot({ type: "state", messageQueue: { items: [], paused: true } })!.messageQueue!.paused, false)
})
