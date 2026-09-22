import type { ChatSnapshot } from "../contract.ts"

/** 已投递但还没被宿主确认的一次发送；保存未经 trim 的原始草稿。 */
export interface PendingSend {
  readonly requestId: string
  readonly text: string
}

export type DraftRetention =
  /** 还没有结论，继续等宿主确认。 */
  | { readonly kind: "waiting" }
  /** 宿主已收下这条消息，草稿可以丢弃。 */
  | { readonly kind: "accepted" }
  /** 拒绝时用户已输入新内容，保留当前草稿。 */
  | { readonly kind: "preserve" }
  /** 没被受理：把原文还回输入框，用户不必重打。 */
  | { readonly kind: "restore"; readonly text: string }

/** 只处理对应请求的明确回执；消息行、连接状态和通知都不是发送确认。 */
export function draftRetention(pending: PendingSend, snapshot: ChatSnapshot, draft: string): DraftRetention {
  const receipt = snapshot.submission
  if (receipt?.requestId !== pending.requestId) return { kind: "waiting" }
  if (receipt.accepted) return { kind: "accepted" }
  if (draft && draft !== pending.text) return { kind: "preserve" }
  return { kind: "restore", text: pending.text }
}
