import type { ChatSnapshot } from "../contract.ts"
import type { DraftRetention, PendingSend } from "./draftRetention.ts"

/**
 * 每个会话各自的未发送草稿。输入框只显示当前会话的草稿，其余会话的草稿暂存在 others 里，
 * 切回该会话时取出。所有者是 ChatApp；宿主只负责保存这份值，重载或换到另一个界面后原样交回。
 */
export interface SessionDrafts {
  /** 输入框里的草稿属于哪个会话；还没对上任何会话时为 null，第一次对上时直接认领，不交换。 */
  readonly current: string | null
  /** 其他会话的非空草稿，按暂存先后排列，超出上限时先丢最早的。 */
  readonly others: Readonly<Record<string, string>>
}

/** 已投递但还没收到回执的发送，记下它来自哪个会话；回执到达时用户可能已经切到别的会话。 */
export interface SessionPendingSend extends PendingSend {
  readonly session: string | null
}

export const emptySessionDrafts: SessionDrafts = Object.freeze({ current: null, others: Object.freeze({}) })

/** 尚未创建线程的新会话。 */
export const newSessionKey = "new"
const maxSessions = 20
const maxKeyLength = 300
const maxDraftLength = 32_000
const maxTotalLength = 64_000

/**
 * 输入框此刻对应的会话。连接中、断开、失败和关闭时 threadId 会短暂变成 null，这不是用户切到新会话，
 * 返回 null 表示保持原归属，不交换草稿。
 */
export function draftSessionKey(snapshot: Pick<ChatSnapshot, "phase" | "threadId">): string | null {
  const { phase } = snapshot
  if (phase === "disconnected" || phase === "connecting" || phase === "failed" || phase === "closing") return null
  return snapshot.threadId ? `thread:${snapshot.threadId}` : newSessionKey
}

export interface SessionEntry {
  sessions: SessionDrafts
  draft: string
  pending: SessionPendingSend | null
}

/**
 * 输入框进入 next 会话：暂存当前草稿，取出 next 的草稿。
 * 新会话发出第一条消息时 Core 才分配线程，这时草稿和待确认的发送随会话一起带到新线程，不当作切换。
 */
export function enterSession(sessions: SessionDrafts, draft: string, next: string, pending: SessionPendingSend | null): SessionEntry {
  if (sessions.current === next) return { sessions, draft, pending }
  if (sessions.current === null) {
    return { sessions: { current: next, others: without(sessions.others, next) }, draft, pending: pending && pending.session === null ? { ...pending, session: next } : pending }
  }
  if (pending?.session === newSessionKey && sessions.current === newSessionKey && next.startsWith("thread:") && !(next in sessions.others)) {
    return { sessions: { current: next, others: sessions.others }, draft, pending: { ...pending, session: next } }
  }
  const stored = sessions.others[next] ?? ""
  return { sessions: { current: next, others: stash(without(sessions.others, next), sessions.current, draft) }, draft: stored, pending }
}

/** 回执到达时发送所在的会话已不在输入框里：按同一回执规则改它暂存的草稿。 */
export function settleStashedSend(sessions: SessionDrafts, pending: SessionPendingSend, retention: Exclude<DraftRetention, { kind: "waiting" }>): SessionDrafts {
  const key = pending.session
  if (key === null || key === sessions.current) return sessions
  const stored = sessions.others[key] ?? ""
  if (retention.kind === "accepted" && stored === pending.text) return { ...sessions, others: without(sessions.others, key) }
  if (retention.kind === "restore") return { ...sessions, others: stash(without(sessions.others, key), key, retention.text) }
  return sessions
}

/** 宿主或页面保存的值来自信任边界之外，逐项校验并套用同一组上限；无效时返回空值。 */
export function parseSessionDrafts(value: unknown): SessionDrafts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptySessionDrafts
  const record = value as { current?: unknown; others?: unknown }
  const current = typeof record.current === "string" && validKey(record.current) ? record.current : null
  let others: Record<string, string> = {}
  if (record.others && typeof record.others === "object" && !Array.isArray(record.others)) {
    for (const [key, text] of Object.entries(record.others)) {
      if (key !== current && validKey(key) && typeof text === "string") others = stash(others, key, text)
    }
  }
  return { current, others }
}

function validKey(key: string): boolean {
  return key.length > 0 && key.length <= maxKeyLength && (key === newSessionKey || key.startsWith("thread:"))
}

function without(others: Readonly<Record<string, string>>, key: string): Readonly<Record<string, string>> {
  if (!(key in others)) return others
  return Object.fromEntries(Object.entries(others).filter(([name]) => name !== key))
}

/** 空草稿不占位置；超出条数或总长时丢弃最早暂存的草稿。 */
function stash(others: Readonly<Record<string, string>>, key: string, text: string): Record<string, string> {
  const entries = Object.entries(without(others, key))
  if (text && text.length <= maxDraftLength) entries.push([key, text])
  let total = entries.reduce((sum, [, value]) => sum + value.length, 0)
  while (entries.length > maxSessions || total > maxTotalLength) total -= entries.shift()![1].length
  return Object.fromEntries(entries)
}
