import postcss, { type Result } from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { readFile } from "node:fs/promises"

/** Compile a stylesheet entry through Tailwind, as the @codem/ui build does for its own entry. */
export async function compileStylesheet(path: string): Promise<Result> {
  return postcss([tailwindcss()]).process(await readFile(path, "utf8"), { from: path })
}

const bridgeSelector = /^body(?:\.vscode-[\w-]+|:is\(\.vscode-[\w-]+(?:, ?\.vscode-[\w-]+)*\))(?:[\s:]|$)/u

/** VS Code ships the shared stylesheet unchanged; besides it, only rules scoped to VS Code's body theme classes are allowed. */
export function checkWebviewStyles(shared: string, webview: string): void {
  const expected = postcss.parse(shared).nodes.filter(node => node.type !== "comment").map(String)
  const actual = postcss.parse(webview).nodes
    .filter(node => node.type !== "comment" && !(node.type === "rule" && node.selectors.every(selector => bridgeSelector.test(selector))))
    .map(String)
  const extra = actual.find(node => !expected.includes(node))
  if (extra) throw new Error(`webview/styles.css may only add VS Code theme bridge rules scoped to body.vscode-*: ${extra.split("\n")[0]}`)
  const index = expected.findIndex((node, position) => actual[position] !== node)
  if (index !== -1) throw new Error(`webview/styles.css must include the unchanged @codem/ui stylesheet; it differs at node ${index + 1}`)
}
