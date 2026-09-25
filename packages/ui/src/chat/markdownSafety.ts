/**
 * 共享消息列表的安全 Markdown：只渲染 Host 下发的正文，不接收原始协议帧。
 * 手法沿用旧 VS Code Webview 的 Markdown 渲染（Marked + DOMPurify 白名单），
 * 整理进 @codem/ui；此处不是 transcript 数据模型，也不做语法高亮或复制按钮。
 */
import { marked, Renderer } from "marked"
import DOMPurify from "dompurify"

const allowedTags = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "a",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
] as const

const allowedAttrs = ["href", "title", "start", "type", "checked", "disabled"] as const

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!)
}

const renderer = new Renderer()
// 代码块先转义，避免围栏内的 <script> 被当成 HTML。
renderer.code = ({ text, lang }) => {
  const language = lang?.match(/^[\w+#.-]+/u)?.[0] ?? ""
  return `<pre title="${escapeHtml(language)}"><code>${escapeHtml(text)}</code></pre>`
}
// 模型或用户写入的原始 HTML 没有权限变成 DOM。
renderer.html = ({ text }) => escapeHtml(text)
renderer.image = ({ text }) => (text ? escapeHtml(text) : "")

/** 只允许 http(s) 外链；javascript / command / file / 相对路径一律去掉。 */
export function isSafeHref(href: string): boolean {
  return /^https?:\/\//iu.test(href.trim())
}

/** 同步解析 Markdown。测试可在无 DOM 环境下检查标签与转义。 */
export function parseMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, renderer })
  if (typeof html !== "string") throw new Error("Markdown parse must be sync")
  return html
}

function applyMarkdownSafety(fragment: DocumentFragment): void {
  for (const link of fragment.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? ""
    if (!isSafeHref(href)) link.removeAttribute("href")
    else {
      link.target = "_blank"
      link.rel = "noopener noreferrer"
    }
  }
  for (const input of fragment.querySelectorAll("input")) {
    if (input.type !== "checkbox") input.remove()
    else input.disabled = true
  }
  for (const pre of fragment.querySelectorAll("pre")) {
    const language = pre.getAttribute("title")?.slice(0, 32) ?? ""
    pre.removeAttribute("title")
    const wrapper = pre.ownerDocument.createElement("div")
    wrapper.className = "codeBlock"
    const header = pre.ownerDocument.createElement("div")
    header.className = "codeHeader"
    header.textContent = language || "代码"
    pre.replaceWith(wrapper)
    wrapper.append(header, pre)
  }
}

/**
 * 把已净化的正文写入目标节点。调用方传入浏览文档上的元素；
 * 流式 assistantText 每次增量整段重绘，不保留半解析状态。
 */
export function renderSafeMarkdown(target: HTMLElement, text: string): void {
  if (!text) {
    target.replaceChildren()
    return
  }
  const view = target.ownerDocument.defaultView
  if (!view) throw new Error("Safe Markdown requires a browsing document")
  const fragment = DOMPurify(view).sanitize(parseMarkdown(text), {
    ALLOWED_TAGS: [...allowedTags],
    ALLOWED_ATTR: [...allowedAttrs],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })
  if (!(fragment instanceof view.DocumentFragment)) throw new Error("Safe Markdown expected a DOM fragment")
  applyMarkdownSafety(fragment)
  target.replaceChildren(fragment)
}
