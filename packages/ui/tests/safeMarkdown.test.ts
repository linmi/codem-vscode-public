import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isHighlightClass } from "../src/chat/codeHighlight.ts"
import { isSafeHref, parseMarkdown } from "../src/chat/markdownSafety.ts"

describe("shared message list safe Markdown", () => {
  it("renders bold, italic, lists, links and fenced code", () => {
    const html = parseMarkdown("**粗体** *斜体*\n\n- 一项\n\n1. 二项\n\n[公开](https://example.com)\n\n```ts\nconst x = \"<script>safe code</script>\"\n```\n")
    assert.match(html, /<strong>粗体<\/strong>/u)
    assert.match(html, /<em>斜体<\/em>/u)
    assert.match(html, /<ul>/u)
    assert.match(html, /<ol>/u)
    assert.match(html, /href="https:\/\/example.com"/u)
    assert.match(html, /<pre title="ts"><code>/u)
    assert.match(html, /&lt;script&gt;safe code&lt;\/script&gt;/u)
  })

  it("escapes raw HTML so it cannot become executable markup", () => {
    const html = parseMarkdown('<script>window.__xss=true</script><img src=x onerror="window.__xss=true">')
    assert.doesNotMatch(html, /<script/iu)
    assert.doesNotMatch(html, /<img/iu)
    assert.match(html, /&lt;script&gt;window\.__xss=true&lt;\/script&gt;/u)
  })

  it("keeps incomplete streaming fences as escaped text or a code block", () => {
    const html = parseMarkdown("先看 **重点**\n\n```ts\nconst ready")
    assert.match(html, /<strong>重点<\/strong>/u)
    assert.doesNotMatch(html, /<script/iu)
    assert.match(html, /<span class="hljs-keyword">const<\/span> ready/u)
  })

  it("only treats http and https as safe link targets", () => {
    assert.equal(isSafeHref("https://example.com"), true)
    assert.equal(isSafeHref("http://example.com/path"), true)
    assert.equal(isSafeHref("javascript:alert(1)"), false)
    assert.equal(isSafeHref("command:codem.connect"), false)
    assert.equal(isSafeHref("file:///etc/passwd"), false)
    assert.equal(isSafeHref("data:text/html,hi"), false)
    assert.equal(isSafeHref("//evil.example"), false)
    assert.equal(isSafeHref("/secret/token"), false)
  })

  it("highlights fenced code in registered languages and their aliases", () => {
    assert.match(parseMarkdown("```ts\nconst x = 1\n```"), /<pre title="ts"><code><span class="hljs-keyword">const<\/span> x = <span class="hljs-number">1<\/span>/u)
    assert.match(parseMarkdown("```TypeScript\nconst x = 1\n```"), /<span class="hljs-keyword">const<\/span>/u)
    assert.match(parseMarkdown("```sh\necho \"hi\"\n```"), /<span class="hljs-built_in">echo<\/span>/u)
    assert.match(parseMarkdown("```kotlin\nfun main() {}\n```"), /<span class="hljs-keyword">fun<\/span>/u)
    assert.match(parseMarkdown("```diff\n-old\n+new\n```"), /<span class="hljs-deletion">-old/u)
  })

  it("keeps markup inside highlighted code escaped", () => {
    const html = parseMarkdown("```html\n<script>window.__xss=true</script>\n```")
    assert.match(html, /<span class="hljs-tag">&lt;<span class="hljs-name">script<\/span>&gt;<\/span>/u)
    assert.doesNotMatch(html, /<script/iu)
  })

  it("leaves unlabelled, unknown and oversized code as escaped plain text", () => {
    assert.match(parseMarkdown("```\nconst x = 1\n```"), /<pre title=""><code>const x = 1<\/code><\/pre>/u)
    assert.match(parseMarkdown("```cobol\nconst x = <1>\n```"), /<pre title="cobol"><code>const x = &lt;1&gt;<\/code><\/pre>/u)
    assert.doesNotMatch(parseMarkdown(`\`\`\`ts\n${"const x = 1\n".repeat(2_000)}\`\`\``), /<span/u)
  })

  it("never turns spans written in prose into markup", () => {
    const html = parseMarkdown('正文 <span class="hljs-keyword">伪装</span>')
    assert.doesNotMatch(html, /<span/u)
    assert.match(html, /&lt;span class=&quot;hljs-keyword&quot;&gt;/u)
  })

  it("accepts only highlight.js scope classes", () => {
    for (const value of ["hljs-keyword", "hljs-built_in", "hljs-title function_", "hljs-title class_ inherited__", "hljs-template-variable"]) assert.equal(isHighlightClass(value), true, value)
    for (const value of ["", "keyword", "hljs-", "HLJS-keyword", "hljs-keyword extra", "hljs-title function", "codeBlock", "hljs-keyword\" onclick=\"x", "hljs-a b_ c"]) assert.equal(isHighlightClass(value), false, value)
  })
})
