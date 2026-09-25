import assert from "node:assert/strict"
import { after, before, it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { ChatSnapshot } from "../src/contract.ts"
import { click, findAll, installDom, renderCounter, type FakeElement } from "./renderProbe.ts"

interface Bundle {
  MessageList: unknown
  asSnapshot: (value: unknown) => ChatSnapshot | null
  createElement: (type: unknown, props: Record<string, unknown>) => unknown
  createRoot: (container: unknown) => { render(element: unknown): void; unmount(): void }
  flushSync: (run: () => void) => void
}

const { container } = installDom()
const rows = ["ChatMessageView", "ActivityItem", "WorkGroup", "TurnChangeList"] as const
let directory = ""
let ui: Bundle

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "codem-message-renders-"))
  const outfile = join(directory, "messageList.cjs")
  await build({
    outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", keepNames: true,
    define: { "process.env.NODE_ENV": '"production"' },
    // DOMPurify needs a real browser; the probe records what Markdown would be drawn instead.
    plugins: [{ name: "markdownProbe", setup(builder) {
      builder.onResolve({ filter: /markdownSafety\.ts$/ }, () => ({ path: "markdownSafety", namespace: "probe" }))
      builder.onLoad({ filter: /.*/, namespace: "probe" }, () => ({ loader: "js", contents: "export function renderSafeMarkdown(node, text) { globalThis.markdownRenders = (globalThis.markdownRenders ?? 0) + 1; node.textContent = text }" }))
    } }],
    stdin: {
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      contents: [
        "export { MessageList } from './src/chat/MessageList.tsx'",
        "export { asSnapshot } from './src/contract.ts'",
        "export { createElement } from 'react'",
        "export { createRoot } from 'react-dom/client'",
        "export { flushSync } from 'react-dom'",
      ].join("\n"),
    },
  })
  ui = (await import(pathToFileURL(outfile).href)).default as Bundle
})

after(() => rm(directory, { recursive: true, force: true }))

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

/** Finished turns as the VS Code bridge delivers them: deeply frozen, and the same objects while unchanged. */
function finishedTurns(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, turn) => {
    const turnId = `turn-${turn}`
    return [
      { id: `${turnId}:user`, role: "user", label: "你", text: `第 ${turn + 1} 轮：检查加载与恢复。`, turnId },
      { id: `${turnId}:reasoning`, role: "reasoning", label: "思考过程", text: "先确认调用链。", summary: "", status: "completed", turnId },
      { id: `${turnId}:tool`, role: "tool", label: "run_bash", text: "通过", summary: "", status: "completed", turnId, details: { kind: "command", fields: [{ label: "工作目录", value: "workspace" }], code: "pnpm test" } },
      { id: `${turnId}:reply`, role: "assistant", label: "CodeM", text: `第 ${turn + 1} 轮已完成。`, turnId },
    ].map(deepFreeze)
  }).flat()
}

/** Like the bridge, a message whose content did not change is delivered as the same frozen object. */
const delivered = new Map<string, Record<string, unknown>>()
function deliver(message: Record<string, unknown>): Record<string, unknown> {
  const key = JSON.stringify(message)
  if (!delivered.has(key)) delivered.set(key, deepFreeze(message))
  return delivered.get(key)!
}

/** One running turn after the finished ones. */
function liveTurn(reply: string, toolOutput: string, toolStatus = "running") {
  return [
    { id: "live:user", role: "user", label: "你", text: "继续流式回复。", turnId: "live" },
    { id: "live:tool", role: "tool", label: "run_bash", text: toolOutput, summary: "", status: toolStatus, turnId: "live", details: { kind: "command", fields: [], code: "pnpm check" } },
    { id: "live:reply", role: "assistant", label: "CodeM", text: reply, turnId: "live" },
  ].map(deliver)
}

function state(messages: readonly unknown[], turns: number, phase = "running", finishedAt: number | null = null): unknown {
  return {
    type: "state", phase, threadId: "thread-1", messages,
    // Diff rows and timings arrive as new objects in every snapshot, as the bridge projects them.
    diffs: Array.from({ length: Math.ceil(turns / 5) }, (_, index) => ({ id: `diff-${index}`, turnId: `turn-${index * 5}`, label: "src/app.ts", added: 2, removed: 1, preview: "complete", available: true })),
    turnTimings: [{ turnId: "live", startedAt: 1_000, finishedAt }],
  }
}

function mount() {
  const root = ui.createRoot(container)
  const count = renderCounter(container as FakeElement, rows)
  /** Runs one synchronous commit and returns what rendered in it; every commit goes through here so the count stays exact. */
  const act = (run: () => void) => {
    ui.flushSync(run)
    return count()
  }
  // ChatApp hands MessageList a new post function on every render.
  const render = (value: unknown) => act(() => root.render(ui.createElement(ui.MessageList, { snapshot: ui.asSnapshot(value)!, post: () => undefined })))
  const press = (target: FakeElement) => act(() => click(container as FakeElement, target))
  return { root, render, press }
}

/** Components rendered and Markdown bodies drawn for each streaming delta. */
function streamingWork(turns: number, deltas = 10) {
  const finished = finishedTurns(turns)
  const { root, render } = mount()
  render(state([...finished, ...liveTurn("开始", "")], turns))
  const replies: Record<string, number>[] = [], tools: Record<string, number>[] = []
  let reply = "开始", output = "", markdown = 0
  for (let index = 0; index < deltas; index++) {
    reply += ` 增量${index}`
    const before = (globalThis as { markdownRenders?: number }).markdownRenders ?? 0
    replies.push(render(state([...finished, ...liveTurn(reply, output)], turns)))
    markdown += ((globalThis as { markdownRenders?: number }).markdownRenders ?? 0) - before
    output += `第 ${index} 行\n`
    tools.push(render(state([...finished, ...liveTurn(reply, output)], turns)))
  }
  const shown = findAll(container as FakeElement, element => element.getAttribute("data-testid") === "chatMessage").at(-1)?.textContent
  ui.flushSync(() => root.unmount())
  return { messages: finished.length + 3, replies, tools, markdownPerDelta: markdown / deltas, shown, reply }
}

it("a streaming delta re-renders only the rows it changed, at any conversation size", () => {
  const small = streamingWork(2), large = streamingWork(125)
  assert.equal(large.messages > 500, true)
  const replyDelta = { ChatMessageView: 1, ActivityItem: 0, WorkGroup: 0, TurnChangeList: 0 }
  const toolDelta = { ChatMessageView: 0, ActivityItem: 1, WorkGroup: 1, TurnChangeList: 0 }
  // Before: every message, work group and change list re-rendered on each delta.
  for (const run of [small, large]) {
    for (const counts of run.replies) assert.deepEqual(counts, replyDelta)
    for (const counts of run.tools) assert.deepEqual(counts, toolDelta)
    assert.equal(run.markdownPerDelta, 1, "Only the streaming reply is drawn again")
    assert.equal(run.shown?.includes(run.reply), true, "The latest streamed text is on screen")
  }
})

it("status changes, working groups and expand state still update around reused rows", () => {
  const finished = finishedTurns(4)
  const { root, render, press } = mount()
  const toolRow = () => findAll(container as FakeElement, element => element.getAttribute("data-testid") === "toolCall")[1]!
  const details = () => toolRow().childNodes.find(node => node.nodeName === "DETAILS") as FakeElement
  const liveGroup = () => findAll(container as FakeElement, element => element.getAttribute("data-testid") === "workGroup").at(-1)!
  render(state([...finished, ...liveTurn("开始", "")], 4))
  assert.equal(liveGroup().getAttribute("data-state"), "running")
  assert.equal(details().hasAttribute("open"), false, "A completed tool starts collapsed")

  assert.deepEqual(press(details().childNodes[0] as FakeElement), { ChatMessageView: 0, ActivityItem: 1, WorkGroup: 0, TurnChangeList: 0 })
  assert.equal(details().hasAttribute("open"), true, "Expanding a tool mid-stream works")
  for (const text of ["开始 一", "开始 一 二"]) assert.equal(render(state([...finished, ...liveTurn(text, "")], 4)).ActivityItem, 0)
  assert.equal(details().hasAttribute("open"), true, "Streaming does not reset an expanded tool")
  press(details().childNodes[0] as FakeElement)
  assert.equal(details().hasAttribute("open"), false, "Collapsing works")

  const failed = finished.map(message => message.id === "turn-1:tool" ? deepFreeze({ ...message, status: "failed", text: "类型检查失败" }) : message)
  assert.deepEqual(render(state([...failed, ...liveTurn("开始 一 二", "")], 4)), { ChatMessageView: 0, ActivityItem: 1, WorkGroup: 1, TurnChangeList: 0 })
  assert.equal(toolRow().getAttribute("data-status"), "failed", "A status change in the middle still shows")
  assert.equal(details().hasAttribute("open"), false, "The user's collapse outlives the status change")

  const completed = render(state([...failed, ...liveTurn("开始 一 二", "done", "completed")], 4, "ready", 5_000))
  assert.equal(completed.WorkGroup >= 1, true)
  assert.equal(liveGroup().getAttribute("data-state"), "completed", "The working group leaves its running state")
  ui.flushSync(() => root.unmount())
})
