import type { ChatSnapshot } from "../contract.ts"

/** 已投递但还没被宿主确认的一次发送。version 是投递当时的快照版本。 */
export interface PendingSend {
  readonly requestId: string
  readonly text: string
  readonly version: number
}

export type DraftRetention =
  /** 还没有结论，继续等宿主确认。 */
  | { readonly kind: "waiting" }
  /** 宿主已收下这条消息，草稿可以丢弃。 */
  | { readonly kind: "accepted" }
  /** 没被受理：把原文还回输入框，用户不必重打。 */
  | { readonly kind: "restore"; readonly text: string }

/**
 * 发送后草稿的去留规则。
 * JetBrains 把 requestId 用作用户消息 id；VS Code 另发 submission 回执，消息 id 不是 requestId。
 * 明确拒绝优先于通知文案。此后才出现、且版本更新过的失败提示，才把原文还回输入框。
 * 用户已经在输入新内容时不覆盖，只丢弃挂起项。
 */
export function draftRetention(pending: PendingSend, snapshot: ChatSnapshot, draft: string): DraftRetention {
  const receipt = snapshot.submission
  if (receipt?.requestId === pending.requestId) {
    if (receipt.accepted || draft) return { kind: "accepted" }
    return { kind: "restore", text: pending.text }
  }
  if (snapshot.messages.some((message) => message.id === pending.requestId)) return { kind: "accepted" }
  if (!snapshot.notice || snapshot.version <= pending.version) return { kind: "waiting" }
  if (draft) return { kind: "accepted" }
  return { kind: "restore", text: pending.text }
}
