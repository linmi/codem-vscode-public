import { highlightCode } from "./codeHighlight.ts"
import { marked, Renderer } from "marked"
import DOMPurify from "dompurify"
import { uiIcon } from "../src/uiIcons.ts"

const renderer = new Renderer()
renderer.code = ({ text, lang }) => {
  const language = lang?.match(/^[\w+#.-]+/)?.[0] ?? ""
  const escaped = text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
  return `<pre title="${language}"><code>${escaped}</code></pre>`
}

/** Model output has no authority to add UI, load images, or execute commands. */
export function renderMarkdown(target: HTMLElement, text: string): void {
  const fragment = DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, renderer }), {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "a", "code", "pre", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td", "input"],
    ALLOWED_ATTR: ["href", "title", "start", "type", "checked", "disabled"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })
  for (const link of fragment.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? ""
    // Local files need an explicit Host path-validation contract; do not invent one here.
    if (!/^https?:\/\//i.test(href)) link.removeAttribute("href")
    else { link.target = "_blank"; link.rel = "noopener noreferrer" }
  }
  for (const input of fragment.querySelectorAll("input")) {
    if (input.type !== "checkbox") input.remove()
    else input.disabled = true
  }
  for (const pre of fragment.querySelectorAll("pre")) {
    const code = pre.querySelector("code")
    if (code) highlightCode(code, pre.title)
    const wrapper = document.createElement("div"); wrapper.className = "codeBlock"
    const header = document.createElement("div"); header.className = "codeHeader"
    const label = document.createElement("span"); label.textContent = pre.title.slice(0, 32) || "代码"; pre.removeAttribute("title")
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "copyMessage"; copy.innerHTML = uiIcon("copy"); copy.setAttribute("aria-label", "复制代码")
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(pre.textContent ?? ""); copy.innerHTML = uiIcon("check"); copy.setAttribute("aria-label", "已复制代码") }
      catch { copy.setAttribute("aria-label", "复制失败，点击重试"); label.textContent = "复制失败，点击重试" }
    })
    const wrap = document.createElement("button"); wrap.type = "button"; wrap.textContent = "换行"; wrap.className = "codeWrap"; wrap.setAttribute("aria-pressed", "false"); wrap.setAttribute("aria-label", "代码自动换行")
    wrap.addEventListener("click", () => { const enabled = wrapper.classList.toggle("wrapCode"); wrap.setAttribute("aria-pressed", String(enabled)) })
    header.append(label, wrap, copy)
    pre.replaceWith(wrapper); wrapper.append(header, pre)
  }
  target.replaceChildren(fragment)
}
