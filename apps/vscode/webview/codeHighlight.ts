import hljs from "highlight.js/lib/core"
import typescript from "highlight.js/lib/languages/typescript"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import bash from "highlight.js/lib/languages/bash"
import python from "highlight.js/lib/languages/python"
import css from "highlight.js/lib/languages/css"
import xml from "highlight.js/lib/languages/xml"
import diff from "highlight.js/lib/languages/diff"
import DOMPurify from "dompurify"
for (const [name, grammar] of Object.entries({ typescript, javascript, json, bash, python, css, xml, diff })) hljs.registerLanguage(name, grammar)

export function highlightCode(code: HTMLElement, language: string): void {
  const text = code.textContent ?? ""
  if (!hljs.getLanguage(language) || text.length > 100_000) return
  const output = hljs.highlight(text, { language, ignoreIllegals: true }).value
  code.replaceChildren(DOMPurify.sanitize(output, { ALLOWED_TAGS: ["span"], ALLOWED_ATTR: ["class"], RETURN_DOM_FRAGMENT: true }))
}
