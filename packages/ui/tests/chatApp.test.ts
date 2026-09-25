import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { asSnapshot, initialSnapshot, type ChatSnapshot, type PendingPanel } from "../src/contract.ts"
import type { CodemUiHost } from "../src/host.ts"
import { permissionIcons, uiIcon } from "../src/chat/uiIcons.ts"

/** 只渲染挂载时的第一帧：不跑 effect，也不等 Host 回复，正好对应首屏与 Host 未响应。 */
interface Views {
  ChatApp: (props: { host: CodemUiHost; initial: ChatSnapshot }) => unknown
  DecisionPanel: (props: { panel: PendingPanel | null; post: (action: Record<string, unknown>) => void }) => unknown
  HistoryPaging: (props: { snapshot: ChatSnapshot; post: (action: Record<string, unknown>) => void }) => unknown
  HistoryResume: (props: { snapshot: ChatSnapshot; post: (action: Record<string, unknown>) => void }) => unknown
  createElement: (type: unknown, props: Record<string, unknown>) => unknown
  renderToStaticMarkup: (element: unknown) => string
}

let directory = ""
let views: Views

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "codem-chat-app-"))
  const outfile = join(directory, "views.cjs")
  await build({ outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", stdin: {
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    contents: [
      "export { ChatApp } from './src/chat/ChatApp.tsx'",
      "export { DecisionPanel } from './src/chat/decisionPanel.tsx'",
      "export { HistoryPaging, HistoryResume } from './src/chat/HistoryPanel.tsx'",
      "export { createElement } from 'react'",
      "export { renderToStaticMarkup } from 'react-dom/server'",
    ].join("\n"),
  } })
  views = (await import(pathToFileURL(outfile).href)).default as Views
})

after(() => rm(directory, { recursive: true, force: true }))

/** 从不回复的 Host：没有快照推送，也没有草稿。 */
const silentHost: CodemUiHost = {
  postAction() {},
  subscribe: () => () => {},
  getState: () => null,
  setState() {},
}

const signedIn: ChatSnapshot["account"] = {
  status: "signedIn",
  refreshing: false,
  notice: null,
  profile: { avatar: { kind: "none" }, displayName: "林晓", userId: "user", tenantId: null, authMethod: "browser" },
}

const question: PendingPanel = {
  id: "question-1",
  kind: "question",
  title: "需要补充信息",
  description: "",
  detail: null,
  choices: [{ id: "yes", label: "是" }],
  allowText: true,
  multiple: false,
  backChoiceId: null,
  initialText: "上一题填过的回答",
  confirmLabel: "确认",
}

function renderApp(initial: ChatSnapshot): string {
  return views.renderToStaticMarkup(views.createElement(views.ChatApp, { host: silentHost, initial }))
}

function answer(html: string): string | undefined {
  return /<textarea[^>]*data-testid="panelText"[^>]*>([^<]*)<\/textarea>/u.exec(html)?.[1]
}

describe("chat panels", () => {
  it("keeps the panel answer inside DecisionPanel and shows the Host draft on first paint", () => {
    assert.equal(answer(views.renderToStaticMarkup(views.createElement(views.DecisionPanel, { panel: question, post: () => {} }))), "上一题填过的回答")
    const html = renderApp({ ...initialSnapshot(), phase: "running", threadId: "thread-1", account: signedIn, pendingPanel: question })
    assert.equal(answer(html), "上一题填过的回答", "ChatApp must not hold a separate, initially empty copy of the answer")
  })
})

describe("composer menu icons", () => {
  /** 触发按钮从开标签到第一个 </button>，图标就在里面。 */
  const trigger = (html: string, id: string) => new RegExp(`<button[^>]*id="${id}"[^>]*>.*?</button>`, "u").exec(html)?.[0] ?? ""

  it("draws the permission, attachment and space icons from the shared icon set", () => {
    const ready = { ...initialSnapshot(), account: signedIn, phase: "ready" as const, workspace: "demo", space: "研发空间" }
    for (const permission of ["default", "auto", "yolo"] as const) {
      const html = renderApp({ ...ready, permission })
      assert.ok(trigger(html, "selectPermission").includes(`<span class="composerMenuIcon" aria-hidden="true">${uiIcon(permissionIcons[permission])}</span>`), permission)
    }
    const html = renderApp(ready)
    assert.ok(trigger(html, "addAttachment").includes(uiIcon("plus")))
    const space = trigger(html, "selectSpace")
    assert.ok(space.includes(uiIcon("space")) && space.includes(uiIcon("chevronDown")))
  })
})

describe("composer controls", () => {
  const editorHost: CodemUiHost = { ...silentHost, surface: "editor" }
  const render = (initial: ChatSnapshot) => views.renderToStaticMarkup(views.createElement(views.ChatApp, { host: editorHost, initial }))
  const disabled = (html: string, id: string) => /\sdisabled=""/u.test(new RegExp(`<button[^>]*id="${id}"[^>]*>`, "u").exec(html)?.[0] ?? "")
  const controls = ["newChat", "addAttachment", "selectWorkMode", "selectPermission", "selectEffort", "selectModel", "selectSpace"]

  it("enables menus and new chat together, and disables them together while anything is working", () => {
    const ready = { ...initialSnapshot(), account: signedIn, phase: "ready" as const, workspace: "demo", space: "研发空间" }
    const idle = render(ready)
    for (const id of controls) assert.equal(disabled(idle, id), false, `${id} while idle`)
    for (const busy of [{ phase: "running" as const }, { backgroundBusy: true }, { sessionTools: { ...ready.sessionTools, busy: "compact" } }]) {
      const html = render({ ...ready, ...busy })
      for (const id of controls) assert.equal(disabled(html, id), true, `${id} with ${JSON.stringify(busy)}`)
    }
  })

  it("labels the message field and send button from the input mode text", () => {
    const html = render({ ...initialSnapshot(), account: signedIn, phase: "ready" })
    assert.match(html, /<label class="visuallyHidden" for="prompt">发送给 CodeM 的消息<\/label>/u)
    assert.match(html, /placeholder="提出问题，或输入 \/ 选择会话操作…"/u)
    assert.match(html, /<button[^>]*id="send"[^>]*aria-label="发送消息"/u)
  })
})

/** 控件自身带 hidden 或根本没渲染都算隐藏；不依赖外层容器是否隐藏。 */
function shown(html: string, opening: RegExp): boolean {
  const tag = opening.exec(html)?.[0]
  return tag !== undefined && !/\shidden=""/u.test(tag)
}

const entries: Record<string, (html: string) => boolean> = {
  retryConnect: (html) => shown(html, /<div id="connection"[^>]*>/u),
  olderMessages: (html) => shown(html, /<button[^>]*>(?=加载更早消息<)/u),
  resumeThread: (html) => shown(html, /<button[^>]*>(?=恢复上次会话<)/u),
}

/** 在同一棵元素树上找到按钮并调用它的 onClick，不合成 DOM。 */
function click(node: unknown, label: string): boolean {
  if (Array.isArray(node)) return node.some((child) => click(child, label))
  const props = (node as { props?: { children?: unknown; onClick?: () => void } } | null)?.props
  if (!props) return false
  if (props.onClick && props.children === label) {
    props.onClick()
    return true
  }
  return click(props.children, label)
}

describe("conditional entries on first paint", () => {
  it("keeps every entry named by the shared first-screen contract hidden while the Host is silent", async () => {
    const fixture = JSON.parse(await readFile(fileURLToPath(new URL("../../contracts/webview/initialSnapshot.json", import.meta.url)), "utf8")) as {
      input: { hostReady: boolean }
      expected: Record<string, unknown> & { hiddenUntilReady: string[] }
    }
    assert.equal(fixture.input.hostReady, false)
    assert.deepEqual(fixture.expected.hiddenUntilReady.filter((name) => !entries[name]), [], "Every contract entry needs a rendered check")
    const { hiddenUntilReady, ...expected } = fixture.expected
    // 挂载时 Host 还没回复：mount 用 initialSnapshot；按合同样例解析出的首屏也一样。
    for (const initial of [initialSnapshot(), asSnapshot(expected)!, { ...initialSnapshot(), account: signedIn }]) {
      const html = renderApp(initial)
      for (const name of hiddenUntilReady) assert.equal(entries[name]!(html), false, name)
    }
  })

  it("does not infer entries from raw fields before the Host sends the flags", () => {
    const html = renderApp({
      ...initialSnapshot(),
      account: signedIn,
      phase: "failed",
      notice: "连接失败",
      threadId: "thread-1",
      resumeThreadId: "thread-old",
      hasOlderMessages: true,
    })
    for (const [name, visible] of Object.entries(entries)) assert.equal(visible(html), false, name)
  })

  it("shows each entry once the Host reports its condition", () => {
    const ready = { ...initialSnapshot(), account: signedIn, phase: "ready" as const, workspace: "demo", space: "研发空间" }
    assert.equal(entries.retryConnect!(renderApp({ ...ready, phase: "failed", canRetry: true, notice: "连接失败，可重试" })), true)
    assert.equal(entries.retryConnect!(renderApp({ ...ready, phase: "disconnected", canRetry: true, notice: "连接已中断" })), true)
    const resume = renderApp({ ...ready, canResume: true, resumeThreadId: "thread-old" })
    assert.equal(entries.resumeThread!(resume), true)
    assert.equal(entries.olderMessages!(resume), false)
    const older = renderApp({ ...ready, threadId: "thread-1", canLoadOlder: true, messages: [{ id: "m1", role: "user", text: "你好" }] })
    assert.equal(entries.olderMessages!(older), true)
    assert.equal(entries.resumeThread!(older), false)
  })

  it("posts the Host-provided thread for resume and a plain request for older messages", () => {
    const actions: Record<string, unknown>[] = []
    const post = (action: Record<string, unknown>) => actions.push(action)
    const ready = { ...initialSnapshot(), account: signedIn, phase: "ready" as const }
    assert.ok(click(views.HistoryResume({ snapshot: { ...ready, canResume: true, resumeThreadId: "thread-old" }, post }), "恢复上次会话"))
    assert.ok(click(views.HistoryPaging({ snapshot: { ...ready, threadId: "thread-1", canLoadOlder: true }, post }), "加载更早消息"))
    assert.deepEqual(actions, [{ type: "resumeThread", threadId: "thread-old" }, { type: "olderMessages" }])
    assert.equal(views.HistoryResume({ snapshot: ready, post }), null)
    assert.equal(views.HistoryPaging({ snapshot: { ...ready, threadId: "thread-1" }, post }), null)
  })
})
