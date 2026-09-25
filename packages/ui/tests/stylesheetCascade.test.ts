import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"
import postcss, { type ChildNode, type Container } from "postcss"
import tailwindcss from "@tailwindcss/postcss"

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
