import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { readSessionHistory, type SessionHistoryPage } from "@codem/session-history"

const at = "2026-09-17T00:00:00Z"

/**
 * 写入一份与 pinned Core 一致的 JSONL schema 13。
 * 内容模拟「用户要求写文件 → 一次 HITL 放行 → 工具成功 → 回合结束」，
 * 供 reload 后的 loadMessages 与 `@codem/session-history` 对照，不另造 transcript store。
 */
export async function writeSchema13HitlSession(options: {
  readonly sessionsRoot: string
  readonly cwd: string
  readonly threadId: string
}): Promise<SessionHistoryPage> {
  const projectHash = createHash("sha256").update(options.cwd).digest("hex").slice(0, 16)
  const directory = join(options.sessionsRoot, projectHash)
  await mkdir(directory, { recursive: true })
  const records: Record<string, unknown>[] = [
    {
      type: "header",
      schema_version: 13,
      session_id: options.threadId,
      cwd: options.cwd,
      started_at: at,
      model: "codem-router/auto",
      provider: "openai_compat",
    },
    {
      type: "user_invocation",
      at,
      submission_id: "submission-hitl",
      input: { kind: "message", content: "Create hitl-ok.txt containing exactly HITL_OK." },
    },
    { type: "turn_request", at, turn_index: 0, model: "codem-router/auto" },
    { type: "assistant_text", at, text: "DONE" },
    {
      type: "tool_call",
      at,
      id: "call-write-1",
      name: "write_file",
      input: { path: "hitl-ok.txt", contents: "HITL_OK" },
    },
    { type: "tool_result", at, id: "call-write-1", status: "completed", content: "wrote hitl-ok.txt" },
    { type: "turn_end", at, turn_index: 0, stop_reason: "EndTurn" },
  ]
  await writeFile(
    join(directory, `${options.threadId}.jsonl`),
    `${records.map((record, index) => JSON.stringify({ ...record, record_seq: index + 1 })).join("\n")}\n`,
  )
  return readSessionHistory({
    sessionsRoot: options.sessionsRoot,
    cwd: options.cwd,
    threadId: options.threadId,
  })
}
