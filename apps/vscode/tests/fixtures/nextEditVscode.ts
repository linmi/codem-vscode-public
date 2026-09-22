/* Deterministic native editor fixture: writes are versioned and emit real-shaped change events. */
export class EventEmitter<T = unknown> {
  listeners: ((event: T) => void)[] = []
  event = (listener: (event: T) => void) => { this.listeners.push(listener); return { dispose: () => { this.listeners = this.listeners.filter(item => item !== listener) } } }
  fire(event: T) { for (const listener of this.listeners) listener(event) }
  dispose() { this.listeners = [] }
}
export class Position {
  constructor(public line: number, public character: number) {}
  isEqual(other: Position) { return this.line === other.line && this.character === other.character }
}
export class Range { constructor(public start: Position, public end: Position) {} }
export class Selection extends Range { get active() { return this.end }; get isEmpty() { return this.start.isEqual(this.end) } }
export class ThemeColor { constructor(public name: string) {} }
export class MarkdownString { appendText() { return this }; appendCodeblock() { return this } }
export class CodeLens { constructor(public range: Range, public command: unknown) {} }
export const StatusBarAlignment = { Right: 1 }, OverviewRulerLane = { Right: 1 }, TextEditorRevealType = { InCenterIfOutsideViewport: 1 }
const disposable = { dispose() {} }
export const control = {
  text: "const label = 1;\nconsole.log(old);\n", writes: 0, apply: true, trusted: true,
  contexts: {} as Record<string, unknown>, commands: {} as Record<string, (...args: unknown[]) => unknown>, messages: [] as string[], undo: [] as string[],
  changed: new EventEmitter<any>(), selected: new EventEmitter<any>(), switched: new EventEmitter<any>(), closed: new EventEmitter<any>(), folders: new EventEmitter<any>(),
  lens: null as any, decoration: [] as any[], bar: null as any, diagnostics: [] as any[],
}
export const document = {
  uri: { scheme: "file", fsPath: "/workspace/example.ts" }, version: 1, isClosed: false, languageId: "typescript",
  get lineCount() { return control.text.split('\n').length },
  getText(range?: Range) { return range ? control.text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : control.text },
  offsetAt(position: Position) { return control.text.split('\n').slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character },
  positionAt(offset: number) { const lines = control.text.slice(0, offset).split('\n'); return new Position(lines.length - 1, lines.at(-1)!.length) },
  lineAt(line: number) { const text = control.text.split('\n')[line]!; return { text, range: new Range(new Position(line, 0), new Position(line, text.replace(/\r$/, '').length)) } },
}
let selection = new Selection(new Position(0, 0), new Position(0, 0))
export const editor = {
  document, get selection() { return selection }, set selection(value: Selection) { selection = value; control.selected.fire({ textEditor: editor }) },
  setDecorations(_kind: unknown, value: unknown[]) { control.decoration = value }, revealRange() {},
  async edit(callback: (builder: { replace(range: Range, text: string): void }) => void, options: unknown) {
    if (!control.apply) return false
    const version = document.version
    let replace: { start: number; end: number; text: string } | undefined
    callback({ replace(range, text) { replace = { start: document.offsetAt(range.start), end: document.offsetAt(range.end), text } } })
    if (!replace || version !== document.version) return false
    control.undo.push(control.text); control.writes++; control.text = control.text.slice(0, replace.start) + replace.text + control.text.slice(replace.end)
    document.version++; control.changed.fire({ document, contentChanges: [{ range: new Range(document.positionAt(replace.start), document.positionAt(replace.end)), rangeOffset: replace.start, rangeLength: replace.end - replace.start, text: replace.text }] })
    if (!options) throw new Error('Explicit undo stops required')
    return true
  },
}
export const window = {
  activeTextEditor: editor as typeof editor | undefined, visibleTextEditors: [editor],
  createTextEditorDecorationType: () => disposable,
  createStatusBarItem: () => { control.bar = { ...disposable, show() {}, hide() {}, text: '' }; return control.bar },
  showWarningMessage: (text: string) => { control.messages.push(text) }, showInformationMessage: (text: string) => { control.messages.push(text) },
  onDidChangeActiveTextEditor: control.switched.event, onDidChangeTextEditorSelection: control.selected.event,
}
export const workspace = { get isTrusted() { return control.trusted }, onDidChangeTextDocument: control.changed.event, onDidCloseTextDocument: control.closed.event, onDidChangeWorkspaceFolders: control.folders.event }
export const languages = { registerCodeLensProvider(_filter: unknown, provider: unknown) { control.lens = provider; return disposable }, getDiagnostics: () => control.diagnostics }
export const commands = { registerCommand(name: string, callback: (...args: unknown[]) => unknown) { control.commands[name] = callback; return disposable }, async executeCommand(_command: string, key: string, value: unknown) { control.contexts[key] = value } }
