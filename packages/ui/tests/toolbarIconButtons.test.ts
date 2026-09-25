import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { after, before, describe, it } from "node:test"
import { build } from "esbuild"
import postcss, { type Rule } from "postcss"
import tailwindcss from "@tailwindcss/postcss"
import { initialSnapshot, type AccountState, type ChatSnapshot } from "../src/contract.ts"
import type { CodemUiHost } from "../src/host.ts"

/**
 * 顶栏与底栏的图标按钮只有一条尺寸与配色规则：shadcn Button 的 toolbar 变体，顶栏配 toolbarIcon（28px），
 * 24px 高的底栏说明行配 footerIcon（24px）。变体是 Tailwind 工具类，Radix Trigger 以 asChild 包住时照样保留；
 * data-slot 会被换掉，所以不能靠 [data-slot="button"] 定尺寸。
 * 每个区域内的按钮必须带上该区域尺寸的全部变体类名（被 className 用 tailwind-merge 挤掉的也算缺），
 * 且没有无层规则再改它的宽高或文字颜色：无层规则压过全部工具类，一写就又回到每个按钮各算各的。
 * 圆角、内边距这类形状差异（如头像按钮）不在此列。
 */
const regions: readonly (readonly [container: string, size: string])[] = [[".sessionHeader", "toolbarIcon"], [".accountHeader", "toolbarIcon"], ["#runtimeDetailsHost", "footerIcon"]]
const sizeAndInk = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|color)$/u
const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

interface MarkupElement { tag: string; attributes: Map<string, string>; classes: string[]; ancestors: MarkupElement[] }

/** React 静态标记够规整，按开闭标签维护一个栈即可得到每个元素的祖先链。 */
function markupElements(markup: string): MarkupElement[] {
  const elements: MarkupElement[] = []
  const open: MarkupElement[] = []
  for (const [, closing, name, rest, selfClosing] of markup.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/gu)) {
    const tag = name!.toLowerCase()
    if (closing) {
      let index = open.length - 1
      while (index >= 0 && open[index]!.tag !== tag) index--
      if (index >= 0) open.length = index
      continue
    }
    const attributes = new Map([...rest!.matchAll(/([^\s=/"']+)(?:="([^"]*)")?/gu)].map(([, key, value]) => [key!.toLowerCase(), value ?? ""] as const))
    const element = { tag, attributes, classes: (attributes.get("class") ?? "").split(/\s+/u).filter(Boolean), ancestors: [...open] }
    elements.push(element)
    if (!selfClosing && !voidTags.has(tag)) open.push(element)
  }
  return elements
}

/** 按顶层空白与 > + ~ 拆出复合选择器；括号、方括号和引号里的内容不拆。 */
function compounds(selector: string): string[] {
  const parts = [""]
  let depth = 0
  let quote = ""
  for (const character of selector) {
    if (quote) quote = character === quote ? "" : quote
    else if (character === '"' || character === "'") quote = character
    else if (character === "(" || character === "[") depth++
    else if (character === ")" || character === "]") depth--
    if (!quote && depth === 0 && /[\s>+~]/u.test(character)) {
      if (parts.at(-1)) parts.push("")
      continue
    }
    parts[parts.length - 1] += character
  }
  return parts.filter(Boolean)
}

/** 伪类和会随交互变化的状态属性（data-state、aria-*）的取值一律当作可能成立，只比元素名、类名、id 和其余属性。 */
function compoundMayMatch(compound: string, element: MarkupElement): boolean {
  let bare = ""
  for (let index = 0; index < compound.length; index++) {
    if (compound[index] === "[") {
      const end = compound.indexOf("]", index)
      bare += compound.slice(index, end + 1)
      index = end
    } else if (compound[index] === ":") {
      index++
      while (index < compound.length && /[\w-]/u.test(compound[index]!)) index++
      if (compound[index] === "(") {
        for (let depth = 0; index < compound.length; index++) {
          if (compound[index] === "(") depth++
          else if (compound[index] === ")" && --depth === 0) break
        }
      } else index--
    } else bare += compound[index]
  }
  const type = /^[a-z][\w-]*/iu.exec(bare)?.[0]
  if (type && type.toLowerCase() !== element.tag) return false
  for (const [, className, id, attribute, operator, value] of bare.matchAll(/\.((?:\\.|[\w-])+)|#((?:\\.|[\w-])+)|\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*("[^"]*"|'[^']*'|[^\]\s]+))?\s*\]/gu)) {
    if (className && !element.classes.includes(className)) return false
    if (id && element.attributes.get("id") !== id) return false
    if (attribute) {
      const actual = element.attributes.get(attribute.toLowerCase())
      if (actual === undefined) return false
      if (operator === "=" && !/^(?:data-state|aria-[\w-]+)$/u.test(attribute) && actual !== value!.replace(/^["']|["']$/gu, "")) return false
    }
  }
  return true
}

/** 组合符一律当作后代关系，伪元素的盒子不是按钮本身；宁可多报，不可漏报。 */
function selectorMayMatch(selector: string, element: MarkupElement): boolean {
  if (selector.includes("::")) return false
  const parts = compounds(selector)
  if (!compoundMayMatch(parts.pop()!, element)) return false
  let ancestors = element.ancestors.slice().reverse()
  for (const part of parts.reverse()) {
    const index = ancestors.findIndex((ancestor) => compoundMayMatch(part, ancestor))
    if (index < 0) return false
    ancestors = ancestors.slice(index + 1)
  }
  return true
}

function inLayer(rule: Rule): boolean {
  for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type === "atrule" && (parent.name === "layer" || parent.name.endsWith("keyframes"))) return true
  }
  return false
}

/** `variantClasses(size)` 返回一个不加 className 的 toolbar Button 在该尺寸下渲染出的类名。 */
function toolbarIconViolations(markup: string, css: string, variantClasses: (size: string) => readonly string[]): string[] {
  const buttons = markupElements(markup).flatMap((element) => {
    const region = regions.find(([container]) => element.ancestors.some((ancestor) => compoundMayMatch(container, ancestor)))
    return element.tag === "button" && region ? [{ element, name: element.attributes.get("aria-label") ?? element.attributes.get("id") ?? "?", size: region[1] }] : []
  })
  const violations: string[] = []
  for (const { element, name, size } of buttons) {
    const variant = element.attributes.get("data-variant")
    const actual = element.attributes.get("data-size")
    if (variant !== "toolbar" || actual !== size) {
      violations.push(`${name} must be a toolbar Button of size ${size}, got variant ${variant ?? "none"} and size ${actual ?? "none"}`)
      continue
    }
    const missing = variantClasses(size).filter((className) => !element.classes.includes(className))
    if (missing.length) violations.push(`${name} lost ${missing.join(" ")} from the shared ${size} variant`)
  }
  for (const { selector, properties } of sizeAndInkRules(css)) {
    for (const { element, name } of buttons) {
      if (selectorMayMatch(selector, element)) violations.push(`${selector} { ${properties} } overrides the shared variant on ${name}`)
    }
  }
  return violations
}

/** 无层且设置宽高或文字颜色的规则，逐个选择器列出；它们压过全部 Tailwind 工具类。 */
function sizeAndInkRules(css: string): { selector: string; properties: string }[] {
  const rules: { selector: string; properties: string }[] = []
  postcss.parse(css).walkRules((rule) => {
    if (inLayer(rule)) return
    const properties = rule.nodes.flatMap((node) => node.type === "decl" && sizeAndInk.test(node.prop) ? [node.prop] : [])
    if (properties.length) for (const selector of rule.selectors) rules.push({ selector, properties: properties.join("; ") })
  })
  return rules
}

/**
 * 输入栏的附件、权限、思考强度是 Select 触发器，不是 Button，共用 .composerMenuTrigger.composerIconTrigger 这条类名规则。
 * 三个都要带这两个类；无层的宽高或文字颜色规则要么命中全部，要么一个都不命中。
 * 属性按当前帧的取值判断：完全访问时权限按钮的警告色取决于 data-mode，首帧是默认权限，不在此列。
 */
const composerIconTriggers = ["addAttachment", "selectPermission", "selectEffort"]

function composerIconTriggerViolations(markup: string, css: string): string[] {
  const elements = markupElements(markup)
  const violations: string[] = []
  const triggers = composerIconTriggers.flatMap((id) => {
    const element = elements.find((candidate) => candidate.attributes.get("id") === id)
    if (!element) violations.push(`#${id} did not render`)
    else if (!element.classes.includes("composerMenuTrigger") || !element.classes.includes("composerIconTrigger")) violations.push(`#${id} does not carry .composerMenuTrigger.composerIconTrigger`)
    return element ? [{ id, element }] : []
  })
  for (const { selector, properties } of sizeAndInkRules(css)) {
    const matched = triggers.filter(({ element }) => selectorMayMatch(selector, element))
    if (matched.length && matched.length < triggers.length) violations.push(`${selector} { ${properties} } styles only ${matched.map(({ id }) => `#${id}`).join(", ")}`)
  }
  return violations
}

const entry = fileURLToPath(new URL("../src/styles.css", import.meta.url))
const shared = (await postcss([tailwindcss()]).process(await readFile(entry, "utf8"), { from: entry })).css

const signedIn: Extract<AccountState, { status: "signedIn" }> = {
  status: "signedIn",
  refreshing: false,
  notice: null,
  profile: { avatar: { kind: "none" }, displayName: "林晓", userId: "user", tenantId: null, authMethod: "browser" },
}

describe("@codem/ui toolbar icon buttons", () => {
  let directory = ""
  let markup = ""
  let variantClasses: (size: string) => string[] = () => []

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "codem-toolbar-icons-"))
    const outfile = join(directory, "views.cjs")
    await build({ outfile, bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", stdin: {
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      contents: [
        "export { ChatApp } from './src/chat/ChatApp.tsx'",
        "export { AccountPage } from './src/chat/AccountPage.tsx'",
        "export { Button } from './src/components/ui/button.tsx'",
        "export { createElement } from 'react'",
        "export { renderToStaticMarkup } from 'react-dom/server'",
      ].join("\n"),
    } })
    const views = (await import(pathToFileURL(outfile).href)).default as {
      ChatApp: unknown
      AccountPage: unknown
      Button: unknown
      createElement: (type: unknown, props: Record<string, unknown>) => unknown
      renderToStaticMarkup: (element: unknown) => string
    }
    const render = (type: unknown, props: Record<string, unknown>) => views.renderToStaticMarkup(views.createElement(type, props))
    const host: CodemUiHost = { postAction() {}, subscribe: () => () => {}, getState: () => null, setState() {}, surface: "editor" }
    const ready: ChatSnapshot = {
      ...initialSnapshot(), phase: "ready", threadId: "thread-1", account: signedIn,
      conversationSearch: { open: false, status: "idle", query: "", hits: [], truncated: false, error: null, target: null, historical: false },
      pluginManagement: { open: false, loaded: false, status: "idle", entries: [], skills: [], error: null, notice: null },
    }
    markup = render(views.ChatApp, { host, initial: ready }) + render(views.AccountPage, { account: signedIn, brandMark: null, focusRequest: 0, onBack() {}, post() {} })
    variantClasses = (size) => /class="([^"]*)"/u.exec(render(views.Button, { variant: "toolbar", size }))![1]!.split(/\s+/u)
  })

  after(() => rm(directory, { recursive: true, force: true }))

  it("sizes and colours every header and footer icon button with the shared toolbar variant", () => {
    const covered = markupElements(markup).filter((element) => element.tag === "button" && element.attributes.get("data-variant") === "toolbar").map((element) => `${element.attributes.get("aria-label")}:${element.attributes.get("data-size")}`)
    // 条件入口（搜索、插件、账户、编辑器页的历史/新建/日志）都要出现在这一帧，检查才不会落空；可访问名称也不能变。
    assert.deepEqual(covered, [
      "搜索当前会话正文:toolbarIcon", "管理插件与技能:toolbarIcon", "文件与工具:toolbarIcon", "个人账户：林晓:toolbarIcon",
      "历史会话:toolbarIcon", "新建会话:toolbarIcon", "查看 CodeM 日志:toolbarIcon", "运行详情与快捷键:footerIcon",
      "返回聊天:toolbarIcon", "刷新账户信息:toolbarIcon",
    ])
    // 顶栏 28px、底栏 24px，都是静默色；尺寸改了要同时改这里。
    for (const className of ["text-muted-foreground", "size-7", "p-1.5", "rounded-lg"]) assert.ok(variantClasses("toolbarIcon").includes(className), className)
    for (const className of ["text-muted-foreground", "size-6", "p-1", "rounded-md"]) assert.ok(variantClasses("footerIcon").includes(className), className)
    assert.deepEqual(toolbarIconViolations(markup, shared, variantClasses), [])
  })

  const classes = (size: string) => size === "toolbarIcon" ? ["text-muted-foreground", "size-7"] : ["text-muted-foreground", "size-6"]
  const header = (buttons: string) => `<div class="app"><header class="sessionHeader"><div class="headerActions">${buttons}</div></header><footer><div class="footerMeta"><button class="spaceButton" aria-label="空间">空间</button><span id="runtimeDetailsHost"><button data-slot="popover-trigger" data-variant="toolbar" data-size="footerIcon" class="text-muted-foreground size-6" aria-label="运行详情"><svg viewBox="0 0 24 24"><path d="M0 0"/></svg></button></span></div></footer></div>`
  const tools = '<button data-slot="dialog-trigger" data-state="closed" data-variant="toolbar" data-size="toolbarIcon" class="text-muted-foreground size-7" id="toggleResources" aria-label="文件与工具"><svg></svg></button>'
  const avatar = '<button data-slot="button" data-variant="toolbar" data-size="toolbarIcon" class="text-muted-foreground size-7 accountTrigger" aria-label="个人账户"><span class="accountAvatar">林</span></button>'

  it("accepts shared-variant buttons, shape-only tweaks and rules for other elements", () => {
    assert.deepEqual(toolbarIconViolations(header(tools + avatar), `@layer base { button { color: inherit; width: auto; } }
@layer utilities { .size-7 { width: 28px; height: 28px; } }
.accountTrigger { padding: 2px; border-radius: 50%; }
.app svg, .footerMeta svg { width: 14px; height: 14px; }
.headerActions { gap: 2px; }
.footerMeta { color: gray; }
.spaceButton:hover:not(:disabled) { color: black; }
.accountLogout button { width: 100%; color: red; }
#toggleResources::after { width: 4px; }
[data-slot="button"] { font-size: 13px; }
[data-slot="dialog-content"] { color: black; width: 600px; }`, classes), [])
  })

  for (const [label, buttons, css, expected] of [
    ["a ghost Button left at the 36px icon size", tools.replace('data-variant="toolbar" data-size="toolbarIcon"', 'data-variant="ghost" data-size="icon"'), "", ["文件与工具 must be a toolbar Button of size toolbarIcon, got variant ghost and size icon"]],
    ["a hand-written header button", '<button class="iconButton" id="newChat" aria-label="新建会话"></button>', "", ["新建会话 must be a toolbar Button of size toolbarIcon, got variant none and size none"]],
    ["the footer size in the header", tools.replace('data-size="toolbarIcon"', 'data-size="footerIcon"').replace("size-7", "size-6"), "", ["文件与工具 must be a toolbar Button of size toolbarIcon, got variant toolbar and size footerIcon"]],
    ["a className that tailwind-merge let replace the size", tools.replace("size-7", "size-9"), "", ["文件与工具 lost size-7 from the shared toolbarIcon variant"]],
    ["a per-button size rule", tools, ".toolPanelTrigger, #toggleResources { width: 28px; height: 28px; }", ["#toggleResources { width; height } overrides the shared variant on 文件与工具"]],
    ["a per-button hover colour", tools + avatar, ".accountTrigger:hover:not(:disabled) { color: black; }", [".accountTrigger:hover:not(:disabled) { color } overrides the shared variant on 个人账户"]],
    ["an open-state colour on a closed trigger", tools, '[data-slot="dialog-trigger"][data-state="open"] { color: black; }', ['[data-slot="dialog-trigger"][data-state="open"] { color } overrides the shared variant on 文件与工具']],
    ["a region rule on nested buttons", tools, ".sessionHeader .headerActions > button { min-height: 32px; }", [".sessionHeader .headerActions > button { min-height } overrides the shared variant on 文件与工具"]],
    ["a data-slot rule on the footer trigger inside @media", tools, '@media (max-width: 340px) { [data-slot="popover-trigger"][data-size] { inline-size: 20px; } }', ['[data-slot="popover-trigger"][data-size] { inline-size } overrides the shared variant on 运行详情']],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.deepEqual(toolbarIconViolations(header(buttons), css, classes), expected)
    })
  }

  it("gives the composer's attachment, permission and effort triggers one class rule", () => {
    assert.deepEqual(composerIconTriggerViolations(markup, shared), [])
  })

  const composer = (effortClass: string) => `<form class="composer"><div class="composerToolbar"><div class="composerLeading"><span id="attachmentMenu"><button id="addAttachment" data-slot="select-trigger" class="composerMenuTrigger composerIconTrigger"></button></span></div><div class="composerTrailing"><span id="permissionMenu"><button id="selectPermission" data-slot="select-trigger" data-mode="default" class="composerMenuTrigger composerIconTrigger"></button></span><span id="effortSelector"><button id="selectEffort" data-slot="select-trigger" class="${effortClass}"><span><svg class="effortSignal"></svg></span></button></span><span id="modelMenu"><button id="selectModel" data-slot="popover-trigger" class="composerMenuTrigger optionButton">Auto</button></span></div></div></form>`

  it("accepts rules shared by all three triggers, their wrappers, the effort signal and state or neighbour rules", () => {
    assert.deepEqual(composerIconTriggerViolations(composer("composerMenuTrigger composerIconTrigger"), `.composerMenuTrigger[data-slot] { height: 28px; color: gray; }
.composerMenuTrigger[data-slot]:hover:not(:disabled) { color: black; }
.composerMenuTrigger.composerIconTrigger { width: 28px; }
[data-slot="select-trigger"] { height: 30px; }
#attachmentMenu, #permissionMenu, #effortSelector { width: 28px; height: 28px; }
#selectEffort .effortSignal { width: 20px; height: 20px; }
#selectPermission[data-mode="yolo"] { color: orange; }
#selectModel { color: black; }
@layer utilities { #selectEffort { width: 1px; } }`), [])
  })

  for (const [label, effortClass, css, expected] of [
    ["an effort trigger with its own rule instead of the shared class", "effortTrigger", "#selectEffort.effortTrigger { width: 28px; height: 28px; color: gray; }", ["#selectEffort does not carry .composerMenuTrigger.composerIconTrigger", "#selectEffort.effortTrigger { width; height; color } styles only #selectEffort"]],
    ["a colour for some of the triggers", "composerMenuTrigger composerIconTrigger", "#addAttachment, .composerTrailing .composerIconTrigger { color: red; }", ["#addAttachment { color } styles only #addAttachment", ".composerTrailing .composerIconTrigger { color } styles only #selectPermission, #selectEffort"]],
    ["a narrow-width size for the leading trigger", "composerMenuTrigger composerIconTrigger", "@media (max-width: 340px) { .composerLeading .composerIconTrigger { width: 24px; } }", [".composerLeading .composerIconTrigger { width } styles only #addAttachment"]],
  ] as const) {
    it(`rejects ${label}`, () => {
      assert.deepEqual(composerIconTriggerViolations(composer(effortClass), css), expected)
    })
  }
})
