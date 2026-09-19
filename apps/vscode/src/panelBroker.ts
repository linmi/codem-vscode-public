import { randomUUID } from "node:crypto"
import type { PermissionChoiceIcon, PanelKind, PanelMessage, PanelReply, PanelView } from "./panelTypes.ts"

export interface PanelInput<T> {
  kind: PanelKind
  title: string
  description?: string
  detail?: string | null
  choices: readonly { value: T; label: string; icon?: PermissionChoiceIcon; description?: string; selected?: boolean }[]
  back?: { value: T }
  initialText?: string
  multiple?: boolean
  allowText?: boolean
  confirmLabel?: string | null
}
interface Pending {
  view: PanelView
  accept(reply: PanelReply): void
  cancel(): void
}

/** A view-bound, one-shot capability. Its lifecycle also follows the controller's AbortSignal. */
export class PanelBroker {
  private owner: object | null = null
  private publish: ((message: PanelMessage) => void) | null = null
  private pending: Pending | null = null

  bind(owner: object, publish: (message: PanelMessage) => void): void {
    this.cancel(); this.owner = owner; this.publish = publish
  }
  unbind(owner: object): void {
    if (owner !== this.owner) return
    this.cancel(); this.owner = null; this.publish = null
  }
  replay(): void { this.publish?.({ type: "panel", panel: this.pending?.view ?? null }) }
  cancel(): void { this.pending?.cancel() }
  answer(owner: object, reply: PanelReply): void {
    const pending = this.pending
    if (owner !== this.owner || !pending || reply.id !== pending.view.id) return
    const view = pending.view
    if (view.backChoiceId && reply.choiceIds.includes(view.backChoiceId)) {
      if (!reply.cancelled && reply.choiceIds.length === 1 && reply.text === "") pending.accept(reply)
      return
    }
    if (!reply.cancelled && (reply.choiceIds.some(id => !view.choices.some(choice => choice.id === id)) || (!view.multiple && reply.choiceIds.length > 1) || (!view.allowText && reply.text !== "") || (!reply.choiceIds.length && !reply.text.trim()) || (view.kind !== "question" && reply.choiceIds.length !== 1))) return
    pending.accept(reply)
  }
  request<T>(input: PanelInput<T>, signal?: AbortSignal): Promise<{ values: T[]; text: string } | null> {
    if (signal?.aborted) return Promise.resolve(null)
    this.cancel()
    if (!this.owner) return Promise.resolve(null)
    if (input.choices.length > 100) return Promise.reject(new Error("Panel option limit exceeded"))
    const choices = input.choices.map(choice => ({ ...choice, id: randomUUID() }))
    const back = input.back ? { id: randomUUID(), value: input.back.value } : null
    const view: PanelView = { id: randomUUID(), kind: input.kind, title: input.title, description: input.description ?? "", detail: input.detail ?? null, choices: choices.map(({ id, label, description, selected, icon }) => ({ ...(icon ? { icon } : {}), id, label, description: description ?? "", selected: selected ?? false })), backChoiceId: back?.id ?? null, initialText: input.initialText ?? "", multiple: input.multiple ?? false, allowText: input.allowText ?? false, confirmLabel: input.confirmLabel ?? null }
    return new Promise(resolve => {
      const finish = (result: { values: T[]; text: string } | null) => {
        if (this.pending !== pending) return
        this.pending = null
        signal?.removeEventListener("abort", abort)
        this.publish?.({ type: "panel", panel: null })
        resolve(result)
      }
      const abort = () => finish(null)
      const pending: Pending = { view, cancel: abort, accept: reply => finish(reply.cancelled ? null : { values: reply.choiceIds.map(id => id === back?.id ? back.value : choices.find(choice => choice.id === id)!.value), text: reply.text.trim() }) }
      this.pending = pending
      signal?.addEventListener("abort", abort, { once: true })
      this.replay()
    })
  }
}
