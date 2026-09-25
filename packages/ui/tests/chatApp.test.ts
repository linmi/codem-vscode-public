import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { initialSnapshot, type ChatSnapshot, type PendingPanel } from "../src/contract.ts"
import type { CodemUiHost } from "../src/host.ts"

/** 只渲染挂载时的第一帧：不跑 effect，也不等 Host 回复，正好对应首屏与 Host 未响应。 */
interface Views {
  ChatApp: (props: { host: CodemUiHost; initial: ChatSnapshot }) => unknown
  DecisionPanel: (props: { panel: PendingPanel | null; post: (action: Record<string, unknown>) => void }) => unknown
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
