/**
 * Queries server-rendered markup with the selector subset the preview runtime uses: tag, #id, .class,
 * [attr] and [attr="value"], :disabled, :not(compound), descendant and child combinators, and lists.
 * Anything else throws, so a new selector form cannot silently pass the preview hook gate.
 */
export interface MarkupElement { tag: string; attrs: Map<string, string>; children: (MarkupElement | string)[]; parent: MarkupElement | null }
interface Compound { tag?: string; id?: string; classes: string[]; attrs: { name: string; value?: string }[]; not: Compound[]; disabled: boolean }
interface Complex { compounds: Compound[]; combinators: (" " | ">")[] }

const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
const decode = (value: string) => value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) =>
  name[0] === "#" ? String.fromCodePoint(Number.parseInt(name.slice(name[1] === "x" || name[1] === "X" ? 2 : 1), name[1] === "x" || name[1] === "X" ? 16 : 10)) : entities[name] ?? entity)

export function parseMarkup(html: string): MarkupElement {
  const root: MarkupElement = { tag: "#document", attrs: new Map(), children: [], parent: null }
  let current = root
  for (const [text, closing, tag, rawAttributes, selfClosing] of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/([\w-]+)\s*>|<([\w-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|[^<]+/g)) {
    if (closing) {
      let open: MarkupElement | null = current
      while (open && open.tag !== closing.toLowerCase()) open = open.parent
      if (open?.parent) current = open.parent
    } else if (tag) {
      const attrs = new Map<string, string>()
      for (const [, name, double, single, bare] of rawAttributes!.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs.set(name!.toLowerCase(), decode(double ?? single ?? bare ?? ""))
      const element: MarkupElement = { tag: tag.toLowerCase(), attrs, children: [], parent: current }
      current.children.push(element)
      if (!selfClosing && !voidTags.has(element.tag)) current = element
    } else if (!text.startsWith("<")) current.children.push(decode(text))
  }
  return root
}

export function textContent(element: MarkupElement): string {
  return element.children.map(child => typeof child === "string" ? child : textContent(child)).join("")
}

export function querySelector(root: MarkupElement, selector: string): MarkupElement | null {
  const list = splitList(selector).map(parseComplex)
  const visit = (element: MarkupElement): MarkupElement | null => {
    for (const child of element.children) {
      if (typeof child === "string") continue
      if (list.some(complex => matches(child, complex, complex.compounds.length - 1))) return child
      const found = visit(child)
      if (found) return found
    }
    return null
  }
  return visit(root)
}

function splitList(selector: string): string[] {
  const parts: string[] = []
  let depth = 0, quoted: string | null = null, start = 0
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index]!
    if (quoted) { if (character === "\\") index++; else if (character === quoted) quoted = null }
    else if (character === '"' || character === "'") quoted = character
    else if (character === "(" || character === "[") depth++
    else if (character === ")" || character === "]") depth--
    else if (character === "," && depth === 0) { parts.push(selector.slice(start, index)); start = index + 1 }
  }
  return [...parts, selector.slice(start)].map(part => part.trim())
}

function parseComplex(source: string): Complex {
  const complex: Complex = { compounds: [], combinators: [] }
  let index = 0
  while (true) {
    const [compound, next] = parseCompound(source, index)
    complex.compounds.push(compound)
    index = next
    let cursor = index
    while (source[cursor] === " ") cursor++
    if (cursor === source.length) return complex
    if (source[cursor] === ">") { complex.combinators.push(">"); cursor++; while (source[cursor] === " ") cursor++ }
    else if (cursor > index) complex.combinators.push(" ")
    else throw new Error(`Unsupported selector: ${source}`)
    index = cursor
  }
}

function parseCompound(source: string, start: number): [Compound, number] {
  const compound: Compound = { classes: [], attrs: [], not: [], disabled: false }
  let index = start
  const name = /^[a-z][\w-]*/i.exec(source.slice(index))
  if (name) { compound.tag = name[0].toLowerCase(); index += name[0].length }
  while (index < source.length) {
    const character = source[index]
    if (character === "#" || character === ".") {
      const identifier = /^[\w-]+/.exec(source.slice(index + 1))
      if (!identifier) throw new Error(`Unsupported selector: ${source}`)
      if (character === "#") compound.id = identifier[0]; else compound.classes.push(identifier[0])
      index += 1 + identifier[0].length
    } else if (character === "[") {
      const attribute = /^\[([\w-]+)(?:="((?:[^"\\]|\\.)*)")?\]/.exec(source.slice(index))
      if (!attribute) throw new Error(`Unsupported selector: ${source}`)
      compound.attrs.push({ name: attribute[1]!.toLowerCase(), ...(attribute[2] === undefined ? {} : { value: attribute[2].replace(/\\(.)/g, "$1") }) })
      index += attribute[0].length
    } else if (source.startsWith(":not(", index)) {
      const [inner, next] = parseCompound(source, index + 5)
      if (source[next] !== ")") throw new Error(`Unsupported selector: ${source}`)
      compound.not.push(inner)
      index = next + 1
    } else if (source.startsWith(":disabled", index)) {
      compound.disabled = true
      index += ":disabled".length
    } else break
  }
  if (index === start) throw new Error(`Unsupported selector: ${source}`)
  return [compound, index]
}

function matchesCompound(element: MarkupElement, compound: Compound): boolean {
  if (compound.tag && element.tag !== compound.tag) return false
  if (compound.id && element.attrs.get("id") !== compound.id) return false
  const classes = (element.attrs.get("class") ?? "").split(/\s+/)
  if (!compound.classes.every(name => classes.includes(name))) return false
  if (!compound.attrs.every(({ name, value }) => element.attrs.has(name) && (value === undefined || element.attrs.get(name) === value))) return false
  if (compound.disabled && !element.attrs.has("disabled")) return false
  return !compound.not.some(inner => matchesCompound(element, inner))
}

function matches(element: MarkupElement, complex: Complex, index: number): boolean {
  if (!matchesCompound(element, complex.compounds[index]!)) return false
  if (index === 0) return true
  if (complex.combinators[index - 1] === ">") return element.parent !== null && element.parent.tag !== "#document" && matches(element.parent, complex, index - 1)
  for (let ancestor = element.parent; ancestor && ancestor.tag !== "#document"; ancestor = ancestor.parent) {
    if (matches(ancestor, complex, index - 1)) return true
  }
  return false
}
