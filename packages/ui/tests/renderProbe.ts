/**
 * Just enough DOM for react-dom/client to mount, update and dispatch clicks in Node, plus a count of
 * which components actually rendered in each commit. The Node tests have no browser; this is not a
 * general DOM and only covers what the message list touches.
 */

type Listener = (event: FakeEvent) => void
interface FakeEvent { type: string; target: FakeNode; bubbles: boolean; cancelable: boolean; defaultPrevented: boolean; timeStamp: number; eventPhase: number; isTrusted: boolean; preventDefault(): void; stopPropagation(): void }

class FakeNode {
  childNodes: FakeNode[] = []
  parentNode: FakeNode | null = null
  readonly listeners: { type: string; listener: Listener; capture: boolean }[] = []
  readonly nodeType: number
  readonly nodeName: string
  ownerDocument: FakeDocument | null
  constructor(nodeType: number, nodeName: string, ownerDocument: FakeDocument | null) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.ownerDocument = ownerDocument
  }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null }
  get lastChild(): FakeNode | null { return this.childNodes.at(-1) ?? null }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? []
    return siblings[siblings.indexOf(this) + 1] ?? null
  }
  get parentElement(): FakeNode | null { return this.parentNode?.nodeType === 1 ? this.parentNode : null }
  appendChild(child: FakeNode): FakeNode { return this.insertBefore(child, null) }
  insertBefore(child: FakeNode, before: FakeNode | null): FakeNode {
    child.parentNode?.removeChild(child)
    const index = before ? this.childNodes.indexOf(before) : -1
    if (index < 0) this.childNodes.push(child)
    else this.childNodes.splice(index, 0, child)
    child.parentNode = this
    return child
  }
  removeChild(child: FakeNode): FakeNode {
    this.childNodes.splice(this.childNodes.indexOf(child), 1)
    child.parentNode = null
    return child
  }
  replaceChildren(...children: FakeNode[]): void {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes = []
    for (const child of children) this.appendChild(child)
  }
  contains(node: FakeNode | null): boolean {
    for (let current = node; current; current = current.parentNode) if (current === this) return true
    return false
  }
  get textContent(): string { return this.childNodes.map(child => child.textContent).join("") }
  set textContent(value: string) { this.replaceChildren(...(value ? [new FakeText(value, this.ownerDocument!)] : [])) }
  addEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void {
    this.listeners.push({ type, listener, capture: options === true || (typeof options === "object" && options.capture === true) })
  }
  removeEventListener(type: string, listener: Listener): void {
    const index = this.listeners.findIndex(item => item.type === type && item.listener === listener)
    if (index >= 0) this.listeners.splice(index, 1)
  }
}

class FakeText extends FakeNode {
  data: string
  constructor(data: string, owner: FakeDocument) {
    super(3, "#text", owner)
    this.data = data
  }
  get nodeValue(): string { return this.data }
  set nodeValue(value: string) { this.data = value }
  get textContent(): string { return this.data }
  set textContent(value: string) { this.data = value }
}

export class FakeElement extends FakeNode {
  readonly attributes = new Map<string, string>()
  readonly style: Record<string, unknown> = { setProperty() {}, removeProperty() {} }
  readonly tagName: string
  readonly localName: string
  readonly namespaceURI: string
  private html = ""
  constructor(tag: string, owner: FakeDocument, namespaceURI = "http://www.w3.org/1999/xhtml") {
    super(1, tag.toUpperCase(), owner)
    this.tagName = tag.toUpperCase()
    this.localName = tag
    this.namespaceURI = namespaceURI
  }
  setAttribute(name: string, value: unknown): void { this.attributes.set(name, String(value)) }
  setAttributeNS(_namespace: string | null, name: string, value: unknown): void { this.setAttribute(name, value) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  removeAttributeNS(_namespace: string | null, name: string): void { this.removeAttribute(name) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  hasAttribute(name: string): boolean { return this.attributes.has(name) }
  get innerHTML(): string { return this.html }
  set innerHTML(value: string) { this.html = value; this.replaceChildren() }
  scrollIntoView(): void {}
  focus(): void {}
  blur(): void {}
}

class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement
  readonly body: FakeElement
  defaultView: unknown = null
  constructor() {
    super(9, "#document", null)
    this.documentElement = new FakeElement("html", this)
    this.body = new FakeElement("body", this)
    this.appendChild(this.documentElement)
    this.documentElement.appendChild(this.body)
  }
  get activeElement(): FakeElement { return this.body }
  createElement(tag: string): FakeElement { return new FakeElement(tag, this) }
  createElementNS(namespace: string, tag: string): FakeElement { return new FakeElement(tag, this, namespace) }
  createTextNode(text: string): FakeText { return new FakeText(text, this) }
}

/** Installs the fake window and document; call before loading react-dom. Timers are inert so a running group never ticks mid-test. */
export function installDom(): { document: FakeDocument; container: FakeElement } {
  const document = new FakeDocument()
  class HTMLIFrameElement {}
  const window = { document, HTMLIFrameElement, navigator: { userAgent: "node" }, event: undefined, setInterval: () => 0, clearInterval: () => undefined, setTimeout, clearTimeout, getComputedStyle: () => ({}) }
  document.defaultView = window
  Object.assign(globalThis, { window, document, HTMLIFrameElement })
  const container = document.createElement("div")
  document.body.appendChild(container)
  return { document, container }
}

/** Delivers a click the way a browser does to React's root listeners: capture phase, then bubble. */
export function click(container: FakeElement, target: FakeNode): void {
  const event: FakeEvent = {
    type: "click", target, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), eventPhase: 3, isTrusted: true,
    preventDefault() { this.defaultPrevented = true }, stopPropagation() {},
  }
  for (const capture of [true, false]) for (const item of container.listeners.filter(entry => entry.type === "click" && entry.capture === capture)) item.listener(event)
}

export function findAll(root: FakeNode, match: (element: FakeElement) => boolean): FakeElement[] {
  const found: FakeElement[] = []
  const visit = (node: FakeNode) => {
    if (node instanceof FakeElement && match(node)) found.push(node)
    for (const child of node.childNodes) visit(child)
  }
  visit(root)
  return found
}

interface Fiber { type: unknown; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null; flags: number; stateNode: { current: Fiber } }
/** React marks a component that ran its render function in this pass with PerformedWork (React DevTools reads the same bit). */
const PerformedWork = 1

/**
 * Counts function components by name that rendered in the latest commit. A subtree React skipped keeps
 * the very fiber objects of the previous commit, so only fibers new to this commit are considered; of
 * those, a mount has no alternate and an update carries PerformedWork. Call it after every commit,
 * clicks included: it compares against the tree it saw last.
 */
export function renderCounter(container: FakeElement, names: readonly string[]) {
  let previous = new Set<Fiber>()
  return () => {
    const key = Object.keys(container).find(name => name.startsWith("__reactContainer$"))
    if (!key) throw new Error("React root not found on the container")
    const counts = Object.fromEntries(names.map(name => [name, 0])) as Record<string, number>
    const seen = new Set<Fiber>()
    const stack: Fiber[] = [((container as unknown as Record<string, Fiber>)[key]!).stateNode.current]
    while (stack.length) {
      const fiber = stack.pop()!
      seen.add(fiber)
      const name = typeof fiber.type === "function" ? fiber.type.name : ""
      if (name in counts && !previous.has(fiber) && (fiber.alternate === null || (fiber.flags & PerformedWork) !== 0)) counts[name]! += 1
      if (fiber.sibling) stack.push(fiber.sibling)
      if (fiber.child) stack.push(fiber.child)
    }
    previous = seen
    return counts
  }
}
