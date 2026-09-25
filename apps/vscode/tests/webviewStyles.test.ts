import assert from "node:assert/strict"
import postcss from "postcss"
import { fileURLToPath } from "node:url"
import { it } from "node:test"
import { checkWebviewStyles, compileStylesheet } from "../scripts/support/webviewStyles.ts"

const shared = (await compileStylesheet(fileURLToPath(import.meta.resolve("@codem/ui/styles.css")))).css
const webview = (await compileStylesheet(fileURLToPath(new URL("../webview/styles.css", import.meta.url)))).css

it("webview styles: VS Code ships the shared @codem/ui stylesheet plus only its theme bridge", () => {
  checkWebviewStyles(shared, webview)
  for (const selector of [".pluginManagementDialog", ".pluginManagementScroll", ".activityAction", ".bg-primary", ".copyMessage", '[data-slot="dialog-content"]']) {
    assert.ok(webview.includes(selector), `${selector} must reach dist/webview.css`)
  }
  assert.match(webview, /body:is\(\.vscode-high-contrast, \.vscode-high-contrast-light\) \.app/u)
})

it("webview styles: accepts rules scoped to VS Code body theme classes", () => {
  checkWebviewStyles(shared, `${shared}\n/* bridge */\nbody.vscode-dark .app { --surface: red; }\nbody:is(.vscode-light, .vscode-dark) .codem-light, body.vscode-high-contrast:hover { color: red; }`)
})

for (const [label, webviewCss] of [
  ["an unscoped component rule", `${shared}\n.copyMessage { color: red; }`],
  ["a rule that only mentions a VS Code class later", `${shared}\n.app body.vscode-dark { color: red; }`],
  ["an at-rule outside the bridge", `${shared}\n@media (min-width: 1px) { body.vscode-dark { color: red; } }`],
] as const) {
  it(`webview styles: rejects ${label}`, () => {
    assert.throws(() => checkWebviewStyles(shared, webviewCss), /may only add VS Code theme bridge rules/)
  })
}

it("webview styles: rejects a forked, partial or missing copy of the shared stylesheet", () => {
  assert.throws(() => checkWebviewStyles(shared, shared.replace(".pluginManagementDialog {", ".forkedDialog {")), /may only add VS Code theme bridge rules scoped to body\.vscode-\*: \.forkedDialog/)
  const partial = postcss.parse(shared)
  partial.each(node => { if (node.type === "rule" && node.selector === ".pluginManagementDialog") node.remove() })
  assert.throws(() => checkWebviewStyles(shared, partial.toString()), /unchanged @codem\/ui stylesheet; it differs at node \d+/)
  assert.throws(() => checkWebviewStyles(shared, "body.vscode-dark .app { --surface: red; }"), /unchanged @codem\/ui stylesheet/)
})
