import { appendContext } from "../src/editorContext.ts"
import type { ComposerDraft, SendResult } from "../src/messages.ts"
import type { ComposerMode, ToolsDraft } from "../src/sessionCommands.ts"
import { ComposerSubmission } from "./composerSubmission.ts"

/** The editable draft and its receipt revision belong to one Webview. No UI or transport. */
export class ComposerState {
  private messageDraft: string
  private toolsDraft: ToolsDraft | undefined
  private inputMode: ComposerMode = "message"
  private scope = ""
  private readonly submission = new ComposerSubmission()

  constructor(saved: Partial<ComposerDraft> = {}) {
    this.messageDraft = saved.draft ?? ""
    this.toolsDraft = saved.tools ? { ...saved.tools } : undefined
  }

  get mode(): ComposerMode { return this.inputMode }
  get text(): string { return this.inputMode === "message" ? this.messageDraft : this.toolsDraft!.text }
  get busy(): boolean { return this.submission.busy }

  snapshot(): ComposerDraft {
    return { draft: this.messageDraft, ...(this.toolsDraft ? { tools: { ...this.toolsDraft } } : {}) }
  }

  edit(text: string): void {
    this.write(text)
    this.submission.edited()
  }

  setMode(mode: ComposerMode): void {
    if (mode !== "message" && (this.toolsDraft?.scope !== this.scope || this.toolsDraft.mode !== mode)) {
      this.toolsDraft = { scope: this.scope, mode, text: "" }
    }
    this.inputMode = mode
    this.submission.edited()
  }

  setContext(context: { workspace: string | null; space: string | null; threadId: string | null }): void {
    const scope = JSON.stringify([context.workspace, context.space, context.threadId])
    if (this.scope !== scope && this.inputMode !== "message") {
      this.inputMode = "message"
      this.submission.reset()
    }
    this.scope = scope
  }

  restore(value: ComposerDraft, pendingRequestId: string | null): void {
    this.messageDraft = value.draft
    this.toolsDraft = value.tools ? { ...value.tools } : undefined
    this.inputMode = "message"
    this.submission.reset()
    if (pendingRequestId) this.submission.begin(pendingRequestId)
  }

  append(text: string): void {
    const next = appendContext(this.messageDraft, text)
    this.setMode("message")
    this.edit(next)
  }

  begin(requestId: string): boolean { return this.submission.begin(requestId) }

  settle(result: SendResult): void {
    if (this.submission.settle(result)) this.write("")
  }

  private write(text: string): void {
    if (this.inputMode === "message") this.messageDraft = text
    else this.toolsDraft = { scope: this.scope, mode: this.inputMode, text }
  }
}
