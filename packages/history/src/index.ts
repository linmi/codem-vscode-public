import type { SessionSearchHit, SessionSearchResult } from "./search/searchTypes.ts"
export type { SessionSearchHit, SessionSearchResult } from "./search/searchTypes.ts"
export type { ConversationAttachment } from "./shared/session/attachment.ts"
export { readSessionImage } from "./sessionImage.ts"
import { createHash } from "node:crypto"
import { realpath, stat, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, dirname } from "node:path"
import { visitSessionTurns } from "./shared/cli-adapter/records/schema.ts"
import { projectHashForCwd } from "./shared/cli-adapter/records/cwd.ts"
import { assertValidCodeMSessionId } from "./shared/session/session-id.ts"
import { createToolPayload } from "./shared/session/tool-payload.ts"
import type { TodoSnapshot } from "./shared/session/todo.ts"
export type { TodoSnapshot } from "./shared/session/todo.ts"
import type { ConversationTurn } from "./shared/session/model.ts"

export { toolPayloadText } from "./shared/session/tool-payload.ts"
export type { ConversationItem, ConversationTurn } from "./shared/session/model.ts"
export interface HistoryTurn {
  readonly turn: ConversationTurn
  readonly submissionId: string | null
}
export interface SessionHistoryPage {
  /** Latest authoritative task list for the whole session, independent of viewport pagination. */
  readonly todoSnapshot: TodoSnapshot | null
  readonly turns: readonly HistoryTurn[]
  readonly nextCursor: string | null
}

/** Mirrors pinned Core's sessions_root_for; CODEM_HOME is deliberately not used. */
export function resolveSessionsRoot(environment: NodeJS.ProcessEnv, home = homedir()): string {
  const root = environment.LINCO_SESSIONS_ROOT ?? join(environment.LINCO_HOME ?? join(home, ".codem"), "sessions")
  if (!isAbsolute(root)) throw new Error("CodeM history sessions root must be absolute")
  return root
}

/** The shared reducer owns record semantics. This host boundary owns paths and viewport pagination. */
interface HistoryReadOptions {
  readonly sessionsRoot: string
  readonly cwd: string
  readonly threadId: string
  readonly limit?: number
  readonly cursor?: string
  readonly signal?: AbortSignal
}
export async function readSessionHistory(options: HistoryReadOptions): Promise<SessionHistoryPage> {
  return replayHistory(options)
}

/** Searches rendered user/assistant text, including unloaded turns; never raw records or hidden prompts. */
export async function searchSessionHistory(options: Omit<HistoryReadOptions, "cursor" | "limit"> & { query: string }): Promise<SessionSearchResult> {
  const query = options.query.trim()
  if (!query || query.length > 512) throw new Error("History search query must contain 1–512 characters")
  const result: { hits: SessionSearchHit[]; truncated: boolean } = { hits: [], truncated: false }
  await replayHistory(options, { query: query.toLowerCase(), result })
  return result
}

async function replayHistory(options: HistoryReadOptions, search?: { query: string; result: { hits: SessionSearchHit[]; truncated: boolean } }): Promise<SessionHistoryPage> {
  const { cwd, threadId, signal } = options
  signal?.throwIfAborted()
  assertValidCodeMSessionId(threadId)
  if (!isAbsolute(cwd) || !isAbsolute(options.sessionsRoot))
    throw new Error("CodeM history requires absolute host paths")
  const limit = options.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new Error("CodeM history limit must be between 1 and 500")
  const root = await realpath(options.sessionsRoot)
  const path = join(root, projectHashForCwd(cwd), `${threadId}.jsonl`)
  if ((await realpath(path)) !== path) throw new Error(`CodeM history ${threadId} must not traverse symbolic links`)
  const before = await stat(path)
  if (!before.isFile()) throw new Error(`CodeM history ${threadId} is not a regular file`)
  const revision = createHash("sha256")
    .update(JSON.stringify([cwd, threadId, before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs]))
    .digest("hex")
  let end = Infinity
  if (options.cursor !== undefined) {
    const match = /^([a-f0-9]{64}):([0-9]+)$/u.exec(options.cursor)
    if (!match || match[1] !== revision || !Number.isSafeInteger(Number(match[2])))
      throw new Error(`CodeM history ${threadId} changed or cursor is invalid; reopen the conversation`)
    end = Number(match[2])
  }
  const turns: HistoryTurn[] = []
  let count = 0
  const submissions = new Set<string>()
  const summary = await visitSessionTurns(
    path,
    { kind: "requested-cwd", cwd, sessionId: threadId },
    (turn, submission) => {
      if (submission.source === "user-invocation" && submission.submissionId !== null) {
        if (submissions.has(submission.submissionId))
          throw new Error(
            `Invalid CodeM session ${threadId}: turn ${turn.index} has a duplicate submission ${submission.submissionId}`,
          )
        submissions.add(submission.submissionId)
      }
      const ordinal = count++
      if (search) {
        for (const item of turn.items) {
          if (item.kind !== "message") continue
          const index = item.text.toLowerCase().indexOf(search.query)
          if (index < 0) continue
          if (search.result.hits.length === 200) { search.result.truncated = true; continue }
          const from = Math.max(0, index - 70)
          const to = Math.min(item.text.length, index + search.query.length + 100)
          search.result.hits.push({
            messageId: `history:${threadId}:${turn.index}:${item.id}`,
            cursor: `${revision}:${ordinal + 1}`,
            role: item.role,
            excerpt: `${from ? "…" : ""}${item.text.slice(from, to)}${to < item.text.length ? "…" : ""}`,
          })
        }
        return
      }
      if (ordinal >= end) return
      turns.push({ turn, submissionId: submission.source === "user-invocation" ? submission.submissionId : null })
      if (turns.length > limit) turns.shift()
    },
    signal ?? null,
  )
  if (!summary.header) throw new Error(`CodeM history ${threadId} is missing its header`)
  if (end !== Infinity && end > count) throw new Error(`CodeM history ${threadId} cursor exceeds the conversation`)
  signal?.throwIfAborted()
  const hydrated = await Promise.all(
    turns.map(
      async (entry): Promise<HistoryTurn> => ({
        ...entry,
        turn: {
          ...entry.turn,
          items: await Promise.all(
            entry.turn.items.map(async (item) => {
              if (item.kind !== "tool-execution" || !item.result?.externalContent) return item
              const manifest = item.result.externalContent
              const blob = join(dirname(path), threadId, manifest.path)
              if ((await realpath(blob)) !== blob)
                throw new Error(`CodeM tool ${item.toolCallId} blob must not traverse symbolic links`)
              const body = await readFile(blob, { signal })
              if (
                body.length !== manifest.byteSize ||
                `sha256:${createHash("sha256").update(body).digest("hex")}` !== manifest.contentHash
              )
                throw new Error(`CodeM tool ${item.toolCallId} blob integrity mismatch`)
              return { ...item, result: createToolPayload(body.toString("utf8")) }
            }),
          ),
        },
      }),
    ),
  )
  const after = await stat(path)
  if (
    (await realpath(path)) !== path ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  )
    throw new Error(`CodeM history ${threadId} changed during replay; retry after the current write`)
  signal?.throwIfAborted()
  const first = Math.min(end, count) - turns.length
  return { todoSnapshot: summary.todoSnapshot, turns: hydrated, nextCursor: first > 0 ? `${revision}:${first}` : null }
}
