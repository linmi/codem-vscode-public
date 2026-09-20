import type { ChatSnapshot, CodeSelectionView, ComposerDraft, EditorMessage, FileSearchResult, FileSelected, SendResult, ViewAction } from "../../src/shared/messages.ts"
import { initialSnapshot } from "../../src/shared/messages.ts"
import { commandUnavailable, inputUnavailable, inputModes, slashQuery, type ComposerMode, type SessionCommandId, type SessionPanelCommand } from "../../src/shared/sessionCommands.ts"
import { createComposerMode, modeLabels } from "./composerMode.tsx"
import { createSessionCommandPanel } from "./sessionCommandPanel.tsx"
import { createSlashCommands } from "./slashCommands.tsx"
import { ComposerState } from "./composerState.ts"
import { installFileMentions } from "./fileMentions.ts"
import { createCodeSelection } from "./codeSelection.tsx"

interface ComposerTransport {
  getState(): Partial<ComposerDraft> | undefined
  setState(value: ComposerDraft): void
  postMessage(action: ViewAction): void
}
interface ComposerElements {
  form: HTMLFormElement
  prompt: HTMLTextAreaElement
  send: HTMLButtonElement
  attachments: HTMLElement
}

/** One input surface for the lifetime of its Webview; state rules stay in ComposerState. */
export function createComposerView(elements: ComposerElements, transport: ComposerTransport, locked: () => boolean, changed: () => void, openMenu: (menu: "files" | "model" | "mode") => void) {
  const { form, prompt, send, attachments } = elements
  const draft = new ComposerState(transport.getState() ?? {})
  let state: ChatSnapshot = initialSnapshot()
  let sendKey = "enter"
  let hostDraftReady = false
  let lastDraft = ""
  let measuredPrompt = ""
  let measuredWidth = -1
  let selection: CodeSelectionView | null = null
  const post = (action: ViewAction) => transport.postMessage(action)
  const selectionHost = document.createElement("div"); selectionHost.className = "codeSelection"; selectionHost.hidden = true; form.prepend(selectionHost)
  const renderSelection = createCodeSelection(selectionHost, post)
  const commandPanelHost = document.createElement("div"); document.body.append(commandPanelHost)
  const commandPanels = createSessionCommandPanel(commandPanelHost, post, () => prompt.focus())
  const modeHost = document.createElement("div"); form.prepend(modeHost)
  const renderMode = createComposerMode(modeHost, () => setMode("message"), post)
  const fileMentions = installFileMentions(prompt, () => draft.mode === "message" && state.phase === "ready" && !locked(), post)
  const commandsHost = document.createElement("span"); commandsHost.id = "slashCommandsHost"; commandsHost.hidden = true; form.append(commandsHost)
  const commands = createSlashCommands(commandsHost, form, prompt, chooseCommand)

  function fitPrompt(): void {
    const width = prompt.clientWidth
    if (prompt.value === measuredPrompt && width === measuredWidth) return
    measuredPrompt = prompt.value; measuredWidth = width
    prompt.style.height = "auto"
    prompt.style.height = `${Math.min(220, Math.max(59, prompt.scrollHeight))}px`
  }
  new ResizeObserver(fitPrompt).observe(prompt)

  function persist(notifyHost = true): void {
    const value = draft.snapshot()
    transport.setState(value)
    const encoded = JSON.stringify(value)
    if (!notifyHost) lastDraft = encoded
    else if (hostDraftReady && encoded !== lastDraft) {
      lastDraft = encoded
      post({ type: "composerChanged", value })
    }
  }

  function isSlashInput(): boolean { return draft.mode !== "shellCommand" && slashQuery(draft.text) !== null }
  function refresh(): void {
    // Avoid resetting selection/caret on unrelated streamed messages.
    if (prompt.value !== draft.text) prompt.value = draft.text
    fitPrompt()
    prompt.disabled = locked()
    send.disabled = (!isSlashInput() && Boolean(inputUnavailable(draft.mode, state))) || !draft.text.trim() || draft.busy || locked() || (draft.mode === "message" && Boolean(selection?.error))
    send.hidden = (state.phase === "running" || state.phase === "stopping") && draft.mode !== "steer"
    send.setAttribute("aria-label", draft.mode === "message" ? "发送消息" : draft.mode === "shellCommand" ? "检查命令" : `发送${modeLabels[draft.mode]}`)
    prompt.setAttribute("aria-label", draft.mode === "message" ? "发送给 CodeM 的消息" : `${modeLabels[draft.mode]}输入`)
    prompt.placeholder = draft.mode === "message" ? "提出问题，或输入 / 选择会话操作…" : draft.mode === "shellCommand" ? "输入要执行的命令…" : `输入${modeLabels[draft.mode]}…`
    attachments.hidden = draft.mode !== "message"
    renderMode(draft.mode, state)
    renderSelection(draft.mode === "message" ? selection : null, draft.busy || locked())
    fileMentions.refresh()
    changed()
  }

  function setMode(mode: ComposerMode): void {
    draft.setMode(mode)
    persist(); refresh(); prompt.focus()
  }
  function chooseCommand(id: SessionCommandId): void {
    if (commandUnavailable(id, state)) return
    if (isSlashInput()) { draft.edit(""); persist(); refresh() }
    const mode = inputModes[id]
    if (mode) { setMode(mode); return }
    if (id === "files" || id === "model" || id === "mode") openMenu(id)
    else if (id === "history") post({ type: "showHistory" })
    else commandPanels.open(id as SessionPanelCommand)
  }
  function submit(): void {
    if (document.activeElement?.closest(".slashMenu")) return
    if (isSlashInput()) { commands.open(slashQuery(draft.text)!); return }
    if (send.disabled) return
    const requestId = crypto.randomUUID()
    const text = draft.text
    const mode = draft.mode
    const threadId = state.threadId
    const submitInput = () => {
      if (draft.mode !== mode || state.threadId !== threadId || inputUnavailable(mode, state) || !draft.begin(requestId)) return
      if (mode === "message") post({ type: "send", text, requestId, ...(selection ? { selectionId: selection.id } : {}) })
      else if (threadId) post({ type: mode, threadId, text, requestId })
      refresh()
    }
    if (mode === "shellCommand") commandPanels.confirmShell(text, submitInput)
    else submitInput()
  }
  form.addEventListener("submit", event => { event.preventDefault(); submit() })
  prompt.addEventListener("input", event => {
    draft.edit(prompt.value); persist(); refresh()
    if (!(event as InputEvent).isComposing && isSlashInput() && !locked()) commands.open(slashQuery(draft.text)!)
  })
  prompt.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && (sendKey === "enter" ? !event.ctrlKey && !event.metaKey : event.ctrlKey || event.metaKey)) { event.preventDefault(); submit() }
  })
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-prompt]")) {
    button.addEventListener("click", () => { draft.edit(button.dataset.prompt ?? ""); persist(); refresh(); prompt.focus() })
  }

  return {
    get pendingMessage(): boolean { return draft.busy && draft.mode === "message" },
    get sendKey(): string { return sendKey },
    refresh,
    requestRestore(): void { post({ type: "composerRestore", value: draft.snapshot() }) },
    update(next: ChatSnapshot): void {
      draft.setContext(next)
      if (next.sessionTools.result) draft.settle({ type: "sendResult", ...next.sessionTools.result })
      state = next
      commandPanels.update(state); commands.update(state)
      persist(); refresh()
    },
    receive(message: EditorMessage | SendResult | FileSearchResult | FileSelected): void {
      switch (message.type) {
        case "codeSelection": selection = message.value; refresh(); break
        case "composerDraft":
          draft.restore(message.value, message.pendingRequestId)
          hostDraftReady = true
          persist(false); refresh()
          if (message.focus) prompt.focus()
          break
        case "appendContext": {
          let accepted = false
          try { draft.append(message.text); accepted = true }
          catch { /* Host reports a rejected receipt; state validation is atomic. */ }
          persist(false); refresh()
          if (accepted) prompt.focus()
          post({ type: "contextAdded", id: message.id, value: draft.snapshot(), accepted })
          break
        }
        case "focusComposer": prompt.focus(); break
        case "editorSettings":
          sendKey = message.sendKey
          send.title = sendKey === "enter" ? "发送消息 · Enter" : "发送消息 · Ctrl / Cmd + Enter"
          break
        case "fileSearchResult": case "fileSelected": fileMentions.receive(message); break
        case "sendResult": draft.settle(message); persist(); refresh(); break
      }
    },
  }
}
