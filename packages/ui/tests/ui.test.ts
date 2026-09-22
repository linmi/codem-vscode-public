import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"
import { asSnapshot, hiddenUntilReady, initialSnapshot, isSignedIn, parseUiAction, visibleControls } from "../src/contract.ts"
import { welcomeState } from "../src/chat/welcomeState.ts"
import { lastActivityId, timelineGroups, workGroupState } from "../src/chat/timelineGroups.ts"
import { activityTitle } from "../src/chat/toolPresentation.ts"
import { workingStatus } from "../src/chat/workingStatus.ts"
import { commandUnavailable, slashQuery } from "../src/chat/slashCommands.ts"
import { draftRetention } from "../src/chat/draftRetention.ts"
import { composerMessageAction, composerTypingLocked, mentionQuery, sendOnEnter } from "../src/chat/composerInput.ts"

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

  it("keeps typing available while the turn is running", () => {
    assert.equal(composerTypingLocked("running"), false)
    assert.equal(composerTypingLocked("ready"), false)
    assert.equal(composerTypingLocked("sending"), true)
    assert.equal(composerTypingLocked("stopping"), true)
  })

  it("sends a follow-up while a turn is running and does not consult background processes", () => {
    assert.equal(composerMessageAction("running"), "steer")
    assert.equal(composerMessageAction("ready"), "send")
    assert.equal(composerMessageAction("disconnected"), "send")
    assert.equal(composerMessageAction("sending"), "none")
    assert.equal(composerMessageAction("stopping"), "none")
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

  it("keeps a submitted draft until the host confirms it", () => {
    const pending = { requestId: "req-1", text: "写一段说明", version: 4 }
    const base = initialSnapshot()
    const accepted = {
      ...base,
      version: 5,
      messages: [{ id: "req-1", role: "user" as const, text: "写一段说明" }],
    }
    assert.deepEqual(draftRetention(pending, asSnapshot(accepted)!, ""), { kind: "accepted" })
    // 发送之后才出现的失败提示：原文还回输入框。
    const rejected = { ...base, version: 5, notice: "CodeM is not connected" }
    assert.deepEqual(draftRetention(pending, asSnapshot(rejected)!, ""), { kind: "restore", text: "写一段说明" })
    // 发送前就存在的提示不算失败证据，继续等待确认。
    const stale = { ...base, version: 4, notice: "CodeM reported a warning" }
    assert.deepEqual(draftRetention(pending, asSnapshot(stale)!, ""), { kind: "waiting" })
    // 用户已经在输入新内容时不覆盖。
    assert.deepEqual(draftRetention(pending, asSnapshot(rejected)!, "新的输入"), { kind: "accepted" })
    const receipt = { ...base, submission: { requestId: "req-1", accepted: false } }
    assert.deepEqual(draftRetention(pending, asSnapshot(receipt)!, ""), { kind: "restore", text: "写一段说明" })
    const confirmed = { ...base, submission: { requestId: "req-1", accepted: true } }
    assert.deepEqual(draftRetention(pending, asSnapshot(confirmed)!, ""), { kind: "accepted" })
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

  it("hides retry until failed+canRetry and shows resume/older only when the snapshot allows", () => {
    assert.deepEqual(visibleControls(initialSnapshot()), { retry: false, resume: false, older: false })
    assert.deepEqual(hiddenUntilReady(), ["olderMessages", "retryConnect", "resumeThread"])
    assert.deepEqual(visibleControls({ phase: "disconnected", canRetry: false, canResume: false, canLoadOlder: false }), {
      retry: false,
      resume: false,
      older: false,
    })
    assert.deepEqual(visibleControls({ phase: "failed", canRetry: true, canResume: false, canLoadOlder: false }), {
      retry: true,
      resume: false,
      older: false,
    })
    assert.deepEqual(visibleControls({ phase: "ready", canRetry: false, canResume: true, canLoadOlder: true }), {
      retry: false,
      resume: true,
      older: true,
    })
    assert.deepEqual(visibleControls({ phase: "closing", canRetry: true, canResume: true, canLoadOlder: true }), {
      retry: false,
      resume: true,
      older: true,
    })
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
})
