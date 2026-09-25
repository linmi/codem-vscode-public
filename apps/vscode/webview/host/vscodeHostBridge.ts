import { asSnapshot, type ChatSnapshot, type ChatTheme, type SelectionView } from "@codem/ui/contract"
import { appendContext } from "../../src/shared/editorContext.ts"

interface DraftCommand {
  revision: number
  text: string
  mode: "message" | "askSideQuestion" | "steer" | "shellCommand"
  focus: boolean
  pendingRequestId: string | null
}

/**
 * VS Code 宿主仍按旧消息分开发 state、审批、选区、草稿和回执。
 * 这里收成一份共享快照。路径只留在宿主，不进入快照。
 */
export interface BridgeUpdate {
  snapshot: ChatSnapshot
  draft?: DraftCommand
  /** 草稿握手回执，不经过共享动作校验。 */
  reply?: Record<string, unknown>
}

interface CodeChip {
  id?: unknown
  label?: unknown
  path?: unknown
  startLine?: unknown
  endLine?: unknown
  error?: unknown
}

export class VscodeHostBridge {
  private state: Record<string, unknown> = { type: "state" }
  private account: unknown = { status: "checking" }
  private accountRequest = 0
  private panel: unknown = null
  private selections: SelectionView[] = []
  private submission: { requestId: string; accepted: boolean } | null = null
  private fileSearch: unknown = null
  private sendKey: "enter" | "modEnter" = "enter"
  private pasteNotice: string | null = null
  private draftText = ""
  private draftRevision = 0
  private version = 0
  private signature = ""
  private unpinnedSelectionId: string | null = null
  private brandMark: string | null = null
  private theme: ChatTheme = "light"
  private previews = new Map<string, { kind: "image"; dataUrl: string } | { kind: "unavailable"; reason: string }>()

  rememberDraft(text: string): void {
    this.draftText = text
  }

  setBrand(mark: string | null): void {
    this.brandMark = mark
  }

  /** VS Code 换主题只改 body class，不发 Host 消息；入口观察到变化后交给这里重新投影。 */
  setTheme(theme: ChatTheme): BridgeUpdate | null {
    if (theme === this.theme) return null
    this.theme = theme
    return { snapshot: this.project() }
  }

  snapshot(): ChatSnapshot {
    return this.project()
  }

  /** 把共享动作译成 VS Code 宿主认识的消息。 */
  toHost(action: Record<string, unknown>): Record<string, unknown> {
    if (action.type === "removeSelection") return { type: "removeCodeSelection", id: action.id }
    if (action.type === "pinSelection") {
      return this.unpinnedSelectionId ? { type: "pinCodeSelection", id: this.unpinnedSelectionId } : { type: "pinSelection" }
    }
    if (action.type === "pasteImages") {
      return { ...action, scope: JSON.stringify([this.state.workspace ?? null, this.state.space ?? null, this.state.threadId ?? null]) }
    }
    if (action.type === "setSendKey") {
      this.sendKey = action.sendKey === "modEnter" ? "modEnter" : "enter"
      return { type: "setSendKey", sendKey: this.sendKey === "enter" ? "enter" : "ctrlEnter" }
    }
    if (action.type === "send") {
      const next: Record<string, unknown> = { type: "send", text: action.text, requestId: action.requestId }
      if (Array.isArray(action.selectionIds)) next.selectionIds = action.selectionIds
      return next
    }
    return action
  }

  receive(message: unknown): BridgeUpdate | null {
    if (!message || typeof message !== "object" || Array.isArray(message)) return null
    const record = message as Record<string, unknown>
    if (record.type === "account" && record.state && typeof record.state === "object") {
      this.account = record.state
      return { snapshot: this.project() }
    }
    // 只转达“请打开”的请求；开合与退出后关闭都由界面负责。
    if (record.type === "showAccount") {
      this.accountRequest += 1
      return { snapshot: this.project() }
    }
    if (record.type === "state") {
      this.absorbState(record)
      return { snapshot: this.project() }
    }
    if (record.type === "panel") {
      this.panel = record.panel ?? null
      return { snapshot: this.project() }
    }
    if (record.type === "codeSelection") {
      this.selections = projectSelections(record.value)
      this.unpinnedSelectionId = this.selections.find((item) => item.pinned === false)?.id ?? null
      return { snapshot: this.project() }
    }
    if (record.type === "sendResult") {
      if (typeof record.requestId === "string" && typeof record.accepted === "boolean") {
        this.submission = { requestId: record.requestId, accepted: record.accepted }
      }
      return { snapshot: this.project() }
    }
    if (record.type === "fileSearchResult") {
      const files = Array.isArray(record.files) ? record.files : []
      this.fileSearch = {
        requestId: record.requestId,
        status: record.error ? "error" : files.length ? "ready" : "empty",
        files,
        error: typeof record.error === "string" ? record.error : null,
      }
      return { snapshot: this.project() }
    }
    if (record.type === "pasteImagesResult") {
      this.pasteNotice = typeof record.error === "string" && record.error ? record.error : null
      return { snapshot: this.project() }
    }
    if (record.type === "editorSettings") {
      this.sendKey = record.sendKey === "ctrlEnter" || record.sendKey === "modEnter" ? "modEnter" : "enter"
      return { snapshot: this.project() }
    }
    if (record.type === "composerDraft") {
      const value = record.value as { draft?: unknown } | undefined
      const text = typeof value?.draft === "string" ? value.draft : ""
      this.draftText = text
      return { snapshot: this.project(), draft: this.draftCommand(text, "message", record.focus === true, typeof record.pendingRequestId === "string" ? record.pendingRequestId : null) }
    }
    if (record.type === "appendContext" && typeof record.id === "string" && typeof record.text === "string") {
      try {
        const text = appendContext(this.draftText, record.text)
        this.draftText = text
        return {
          snapshot: this.project(),
          draft: this.draftCommand(text, "message", true, null),
          reply: { type: "contextAdded", id: record.id, accepted: true, value: { draft: text } },
        }
      } catch {
        return {
          snapshot: this.project(),
          reply: { type: "contextAdded", id: record.id, accepted: false, value: { draft: this.draftText } },
        }
      }
    }
    if (record.type === "imageResult" && typeof record.id === "string") {
      const preview = record.preview
      if (preview && typeof preview === "object" && (preview as { kind?: unknown }).kind === "image" && typeof (preview as { dataUrl?: unknown }).dataUrl === "string") {
        this.previews.set(record.id, { kind: "image", dataUrl: (preview as { dataUrl: string }).dataUrl })
      } else if (preview && typeof preview === "object" && (preview as { kind?: unknown }).kind === "unavailable") {
        const reason = (preview as { reason?: unknown }).reason
        this.previews.set(record.id, { kind: "unavailable", reason: typeof reason === "string" ? reason : "图片暂不可用" })
      }
      return { snapshot: this.project() }
    }
    if (record.type === "focusComposer") {
      return { snapshot: this.project(), draft: this.draftCommand(this.draftText, "message", true, null) }
    }
    return null
  }

  private draftCommand(text: string, mode: DraftCommand["mode"], focus: boolean, pendingRequestId: string | null): DraftCommand {
    this.draftRevision += 1
    return { revision: this.draftRevision, text, mode, focus, pendingRequestId }
  }

  private absorbState(record: Record<string, unknown>): void {
    const previous = JSON.stringify([this.state.workspace ?? null, this.state.space ?? null, this.state.threadId ?? null])
    this.pasteNotice = null
    this.state = record
    const next = JSON.stringify([record.workspace ?? null, record.space ?? null, record.threadId ?? null])
    if (previous !== next) this.fileSearch = null
    const tools = record.sessionTools
    if (!tools || typeof tools !== "object" || Array.isArray(tools)) return
    const result = (tools as { result?: unknown }).result
    if (!result || typeof result !== "object" || Array.isArray(result)) return
    const receipt = result as { requestId?: unknown; accepted?: unknown }
    if (typeof receipt.requestId === "string" && typeof receipt.accepted === "boolean") {
      this.submission = { requestId: receipt.requestId, accepted: receipt.accepted }
    }
  }

  private project(): ChatSnapshot {
    const tasks = Array.isArray(this.state.backgroundTasks) ? this.state.backgroundTasks : []
    const background = [
      ...(Array.isArray(this.state.background) ? this.state.background : []),
      ...tasks.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const task = item as { id?: unknown; label?: unknown; phase?: unknown }
        return [{ id: task.id, label: task.label, inProgress: task.phase === "queued" || task.phase === "started" }]
      }),
    ]
    const notice = typeof this.state.notice === "string" ? this.state.notice : null
    const attachments = Array.isArray(this.state.attachments)
      ? this.state.attachments.map((item) => {
          if (!item || typeof item !== "object") return item
          const row = item as { id?: unknown }
          const preview = typeof row.id === "string" ? this.previews.get(row.id) : undefined
          return preview ? { ...item, preview } : item
        })
      : this.state.attachments
    const projected = {
      ...this.state,
      type: "state",
      attachments,
      brandMark: this.brandMark,
      theme: this.theme,
      account: this.account,
      accountRequest: this.accountRequest,
      pendingPanel: this.panel,
      selections: this.selections,
      submission: this.submission,
      fileSearch: this.fileSearch,
      sendKey: this.sendKey,
      background,
      notice: notice ?? this.pasteNotice,
    }
    const signature = JSON.stringify({ ...projected, version: 0 })
    if (signature !== this.signature) {
      this.signature = signature
      this.version += 1
    }
    return asSnapshot({ ...projected, version: this.version }) ?? asSnapshot({ type: "state", version: this.version })!
  }
}

/** 按 VS Code 写在 body 上的主题 class 判断明暗。 */
export function vscodeTheme(classes: { contains(token: string): boolean }): ChatTheme {
  return classes.contains("vscode-dark") || classes.contains("vscode-high-contrast") ? "dark" : "light"
}

function projectSelections(value: unknown): SelectionView[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const view = value as { current?: unknown; pinned?: unknown }
  const pinned = Array.isArray(view.pinned) ? view.pinned : []
  return [...pinned.flatMap((item) => chip(item, true)), ...chip(view.current, false)]
}

function chip(value: unknown, pinned: boolean): SelectionView[] {
  if (!value || typeof value !== "object") return []
  const row = value as CodeChip
  if (typeof row.id !== "string" || typeof row.label !== "string" || !row.label.trim()) return []
  const error = typeof row.error === "string" && row.error.trim() ? row.error : null
  return [{
    id: row.id,
    label: row.label,
    startLine: typeof row.startLine === "number" ? row.startLine : null,
    endLine: typeof row.endLine === "number" ? row.endLine : null,
    pinned,
    ...(error ? { error } : {}),
  }]
}
