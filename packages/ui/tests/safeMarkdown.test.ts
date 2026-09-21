import assert from "node:assert/strict"
import { describe, it } from "node:test"
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
    assert.match(html, /const ready/u)
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
})
