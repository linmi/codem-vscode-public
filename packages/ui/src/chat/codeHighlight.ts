/**
 * 代码块语法高亮：只注册常用语法，未注册或过长的代码保持纯文本。
 * highlight.js 输出只含转义后的文本与 `<span class="hljs-…">`；Markdown 净化时
 * 再按 isHighlightClass 过滤 class，不给模型正文新增属性。
 */
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import diff from "highlight.js/lib/languages/diff"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import kotlin from "highlight.js/lib/languages/kotlin"
import python from "highlight.js/lib/languages/python"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"

hljs.registerLanguage("bash", bash)
hljs.registerLanguage("css", css)
hljs.registerLanguage("diff", diff)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("kotlin", kotlin)
hljs.registerLanguage("python", python)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("xml", xml)

/** 流式正文每次增量都会整段重绘，超过此长度的代码块不高亮。 */
const MAX_HIGHLIGHT_LENGTH = 20_000

/** 返回高亮后的 HTML；语言未注册、未标注或代码过长时返回 null，由调用方转义原文。 */
export function highlightCode(text: string, language: string): string | null {
  if (!language || text.length > MAX_HIGHLIGHT_LENGTH || !hljs.getLanguage(language)) return null
  return hljs.highlight(text, { language, ignoreIllegals: true }).value
}

/** highlight.js 11 的 class：首个为 `hljs-<scope>`，其后为 `function_` 这类带下划线的子作用域。 */
export function isHighlightClass(value: string): boolean {
  const [scope, ...rest] = value.trim().split(/\s+/u)
  return /^hljs-[a-z][a-z0-9_-]*$/u.test(scope ?? "") && rest.every((part) => /^[a-z][a-z0-9]*_+$/u.test(part))
}
