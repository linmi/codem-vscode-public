import assert from "node:assert/strict"
import { it } from "node:test"
import { build } from "esbuild"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { CatalogSnapshot } from "../src/contract.ts"

it("renders actual snapshot rows and gates pagination, errors and cancellation before paint", async t => {
  const directory = await mkdtemp(join(tmpdir(), "codem-live-view-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, "view.cjs")
  await build({ outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", stdin: {
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    contents: `export { LiveSnapshotView } from './src/chat/liveSnapshotView.tsx'; export { renderToStaticMarkup } from 'react-dom/server';`,
  } })
  const { LiveSnapshotView, renderToStaticMarkup } = (await import(pathToFileURL(outfile).href)).default
  const actions: unknown[] = []
  const view: CatalogSnapshot = {
    kind: "live", snapshotId: "snap-1", loaded: true, stale: false, loading: null, error: null,
    rows: [{ label: "已加载会话", detail: "1 个" }],
    pages: {
      turns: { rows: [{ label: "轮次 1", detail: "completed · 2026-09-22" }], total: 2, hasMore: true },
      items: { rows: [{ label: "项目 1 · toolCall", detail: "completed <script>" }], total: 1, hasMore: false },
    },
  }
  const render = (value: CatalogSnapshot, disabled = false) => LiveSnapshotView({ view: value, disabled, post: (action: unknown) => actions.push(action) })
  const html = renderToStaticMarkup(render(view))
  assert.match(html, /轮次 1/); assert.match(html, /completed · 2026-09-22/)
  assert.match(html, /项目 1 · toolCall/); assert.match(html, /&lt;script&gt;/)
  assert.match(html, /加载更多轮次/); assert.doesNotMatch(html, /加载更多Item|取消加载/)
  for (const patch of [{ loaded: false }, { stale: true }, { snapshotId: undefined }, { pages: null }]) {
    assert.doesNotMatch(renderToStaticMarkup(render({ ...view, ...patch })), /加载更多/)
  }
  assert.doesNotMatch(renderToStaticMarkup(render({ ...view, loaded: false, pages: null, rows: [] })), /加载更多|取消加载/)
  const failed = renderToStaticMarkup(render({ ...view, error: "加载失败，可重试" }))
  assert.match(failed, /role="alert"/); assert.match(failed, /轮次 1/); assert.match(failed, /加载更多轮次/)
  const loading = renderToStaticMarkup(render({ ...view, loading: "turns" }))
  assert.match(loading, /正在加载轮次/); assert.match(loading, /取消加载/); assert.match(loading, /disabled=""/)
  assert.match(renderToStaticMarkup(render(view, true)), /disabled=""/)
  // Inspect handlers on the same rendered element tree, without synthesizing DOM or RPC replies.
  type Element = { props?: { children?: unknown; onClick?: () => void } }
  function click(node: unknown, label: string): boolean {
    if (Array.isArray(node)) return node.some(child => click(child, label))
    const props = (node as Element | null)?.props
    if (!props) return false
    const text = (children: unknown): string => Array.isArray(children) ? children.map(text).join("") : typeof children === "string" ? children : ""
    if (props.onClick && text(props.children) === label) { props.onClick(); return true }
    return click(props.children, label)
  }
  assert.ok(click(render(view), "加载更多轮次"))
  assert.ok(click(render({ ...view, loading: "items" }), "取消加载"))
  assert.deepEqual(actions, [{ type: "loadMoreLiveSnapshot", snapshotId: "snap-1", kind: "turns" }, { type: "cancelLiveSnapshot", snapshotId: "snap-1" }])
})
