import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { after, before, describe, it } from "node:test"
import { build } from "esbuild"
import postcss, { type ChildNode, type Container } from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { initialSnapshot, type ChatSnapshot } from "../src/contract.ts"
import type { CodemUiHost } from "../src/host.ts"

/**
 * 共享样式的层级门禁。Tailwind 工具类在 @layer utilities 里，任何无层规则都比它优先：
 * 无层的元素选择器（如 button { background: transparent }）会盖掉 shadcn 按钮的边框、底色和悬停，
 * !important 又会让同一组件后面的状态规则失效。元素默认样式只能放在排在 utilities 之前的 base 层。
 */
function cascadeViolations(css: string): string[] {
  const root = postcss.parse(css)
  const violations: string[] = []

  const order: string[] = []
  root.walkAtRules("layer", (rule) => {
    if (rule.parent?.type !== "root") return
    for (const name of rule.nodes ? [rule.params] : rule.params.split(",")) {
      const layer = name.trim()
      if (layer && !order.includes(layer)) order.push(layer)
    }
  })
  if (order.includes("base") && order.includes("utilities") && order.indexOf("base") > order.indexOf("utilities")) {
    violations.push(`@layer base must be ordered before utilities: ${order.join(", ")}`)
  }

  root.walkRules((rule) => {
    if (rule.parent?.type === "rule" || inKeyframes(rule) || outerLayer(rule) !== null) return
    if (onlyCustomProperties(rule)) return
    const global = rule.selectors.filter(isElementSelector)
    if (global.length) violations.push(`unlayered element rule overrides Tailwind utilities: ${global.join(", ")}`)
  })

  root.walkDecls((decl) => {
    if (decl.important && outerLayer(decl) !== "base") {
      const owner = decl.parent?.type === "rule" ? decl.parent.selectors.join(", ") : "?"
      violations.push(`!important outside @layer base: ${owner} { ${decl.prop} }`)
    }
  })
  return violations
}

/** Outermost cascade layer around a node, or null when unlayered. */
function outerLayer(node: ChildNode): string | null {
  let layer: string | null = null
  for (let parent = node.parent; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type === "atrule" && parent.name === "layer") layer = parent.params.trim()
  }
  return layer
}

function inKeyframes(node: ChildNode): boolean {
  for (let parent = node.parent; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type === "atrule" && parent.name.endsWith("keyframes")) return true
  }
  return false
}

/** Token rules only define custom properties, including Tailwind's @supports fallbacks nested inside them. */
function onlyCustomProperties(container: Container): boolean {
  return (container.nodes ?? []).every((node) =>
    node.type === "comment" || (node.type === "decl" && node.prop.startsWith("--")) || (node.type === "atrule" && onlyCustomProperties(node)))
}

/** A selector that matches by element type (or *) alone: no class, id or attribute outside pseudo-class arguments. */
function isElementSelector(selector: string): boolean {
  let outer = ""
  let depth = 0
  for (const character of selector) {
    if (character === "(") depth++
    else if (character === ")") depth--
    else if (depth === 0) outer += character
  }
  return !/[.#[]/.test(outer) && outer.split(/[\s>+~]+/).some((compound) => /^(?:[a-z][\w-]*|\*)/i.test(compound))
}

const entry = fileURLToPath(new URL("../src/styles.css", import.meta.url))
const shared = (await postcss([tailwindcss()]).process(await readFile(entry, "utf8"), { from: entry })).css
const layerOrder = "@layer theme, base, utilities;"

describe("@codem/ui stylesheet cascade", () => {
  it("keeps element defaults in @layer base ahead of Tailwind utilities, with no stray !important", () => {
    assert.deepEqual(cascadeViolations(shared), [])
    const base = postcss.parse(shared).nodes.find((node) => node.type === "atrule" && node.name === "layer" && node.params === "base")
    assert.ok(base?.type === "atrule", "the shared stylesheet must compile an @layer base block")
    const selectors: string[] = []
    base.walkRules((rule) => { selectors.push(...rule.selectors) })
    for (const selector of ["button", "button:hover:not(:disabled)", "html", "body", "[hidden]"]) {
      assert.ok(selectors.includes(selector), `${selector} must live in @layer base`)
    }
  })

  it("accepts layered element defaults, scoped component rules, tokens and keyframes", () => {
    assert.deepEqual(cascadeViolations(`${layerOrder}
@layer base { button { border: 0; } button:hover:not(:disabled) { color: red; } [hidden] { display: none !important; } }
@layer base { @media (prefers-reduced-motion: reduce) { * { animation: none !important; } } }
@layer utilities { .bg-primary { background: black; } }
:root, .codem-dark { --surface: #111; }
:root { color-scheme: light; }
.composer button, .app > footer, .activityMessage summary:hover { color: red; }
#scrollArea:has(.welcome) { display: flex; }
@keyframes pulse { 50% { opacity: .5; } }`), [])
  })

  for (const [label, css, message] of [
    ["an unlayered element reset", `${shared}\nbutton { background: transparent; }`, /unlayered element rule overrides Tailwind utilities: button$/],
    ["an unlayered universal reset", `${shared}\n* { box-sizing: border-box; }`, /unlayered element rule overrides Tailwind utilities: \*$/],
    ["an element hover rule inside @media", `${shared}\n@media (min-width: 1px) { button:hover:not(:disabled), .x { color: red; } }`, /unlayered element rule overrides Tailwind utilities: button:hover:not\(:disabled\)$/],
    ["an element rule whose only class sits inside :has()", `${shared}\nmain:has(.welcome) { display: flex; }`, /unlayered element rule overrides Tailwind utilities: main:has\(\.welcome\)$/],
    ["!important on a product rule", `${shared}\n.sendButton { background: red !important; }`, /!important outside @layer base: \.sendButton \{ background \}/],
    ["!important inside another layer", `${shared}\n@layer utilities { .x { color: red !important; } }`, /!important outside @layer base: \.x \{ color \}/],
    ["base ordered after utilities", shared.replace(layerOrder, "@layer theme, utilities;"), /@layer base must be ordered before utilities: properties, theme, utilities, base/],
  ] as const) {
    it(`rejects ${label}`, () => {
      const violations = cascadeViolations(css)
      assert.equal(violations.length, 1, violations.join("\n"))
      assert.match(violations[0]!, message)
    })
  }
})

/** Each stylesheet styles.css imports, keyed by its file name. */
async function sourceStylesheets(): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const [, name] of (await readFile(entry, "utf8")).matchAll(/@import "\.\/styles\/([\w.]+\.css)"/gu)) {
    files.set(name!, await readFile(fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)), "utf8"))
  }
  return files
}

/**
 * shadcn 的 Trigger/Close 以 asChild 包住 Button 时，会把 Button 的 data-slot 换成自己的（dialog-trigger、popover-trigger…），
 * .x[data-slot="button"] 这类规则就永远不命中。类名出现在渲染结果里时，限定它的 data-slot 必须至少命中其中一个元素。
 */
function deadSlotSelectors(css: string, markup: string): string[] {
  const elements = [...markup.matchAll(/<[a-z][\w-]*\s([^>]*)>/gu)].map(([, attributes]) => ({
    classes: /(?:^|\s)class="([^"]*)"/u.exec(attributes!)?.[1]!.split(/\s+/u) ?? [],
    slot: /(?:^|\s)data-slot="([^"]*)"/u.exec(attributes!)?.[1] ?? "none",
  }))
  const dead: string[] = []
  postcss.parse(css).walkRules((rule) => {
    for (const selector of rule.selectors) {
      for (const [, name, slot] of selector.matchAll(/\.([A-Za-z][\w-]*)(?:\.[\w-]+|\[[^\]]*\])*?\[data-slot="([\w-]+)"\]/gu)) {
        const owners = elements.filter((element) => element.classes.includes(name!))
        if (owners.length && !owners.some((element) => element.slot === slot)) {
          dead.push(`${selector} never matches: rendered .${name} has data-slot ${[...new Set(owners.map((element) => element.slot))].join(", ")}`)
        }
      }
    }
  })
  return dead
}

describe("@codem/ui stylesheet selectors against the rendered chat", () => {
  let directory = ""
  let firstFrame = ""

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "codem-stylesheet-"))
    const outfile = join(directory, "views.cjs")
    await build({ outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", stdin: {
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      contents: "export { ChatApp } from './src/chat/ChatApp.tsx'\nexport { createElement } from 'react'\nexport { renderToStaticMarkup } from 'react-dom/server'",
    } })
    const views = (await import(pathToFileURL(outfile).href)).default as {
      ChatApp: (props: { host: CodemUiHost; initial: ChatSnapshot }) => unknown
      createElement: (type: unknown, props: Record<string, unknown>) => unknown
      renderToStaticMarkup: (element: unknown) => string
    }
    const host: CodemUiHost = { postAction() {}, subscribe: () => () => {}, getState: () => null, setState() {} }
    firstFrame = views.renderToStaticMarkup(views.createElement(views.ChatApp, { host, initial: { ...initialSnapshot(), phase: "ready", threadId: "thread-1" } }))
  })

  after(() => rm(directory, { recursive: true, force: true }))

  it("qualifies rendered classes only with data-slot values they actually carry", async () => {
    for (const id of ["toggleResources", "runtimeDetails"]) assert.match(firstFrame, new RegExp(`id="${id}"`, "u"), `${id} must render in the first frame for this check to cover it`)
    const dead = [...(await sourceStylesheets())].flatMap(([name, css]) => deadSlotSelectors(css, firstFrame).map((entry) => `${name}: ${entry}`))
    assert.deepEqual(dead, [])
  })

  it("rejects a data-slot qualifier that an asChild trigger replaced, and accepts class-only or matching ones", () => {
    const markup = '<div class="app"><button class="toolPanelTrigger other" data-slot="dialog-trigger" id="x"></button></div>'
    assert.deepEqual(deadSlotSelectors('.toolPanelTrigger[data-slot="button"] { width: 28px; }', markup), [
      '.toolPanelTrigger[data-slot="button"] never matches: rendered .toolPanelTrigger has data-slot dialog-trigger',
    ])
    assert.deepEqual(deadSlotSelectors(`.toolPanelTrigger { width: 28px; }
.toolPanelTrigger[data-slot="dialog-trigger"][data-state="open"] { color: red; }
.portalOnly[data-slot="dialog-content"] { width: 1px; }`, markup), [])
  })
})
