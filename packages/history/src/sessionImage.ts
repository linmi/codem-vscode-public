import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { open, realpath } from "node:fs/promises"
import { join } from "node:path"
import { projectHashForCwd } from "./shared/cli-adapter/records/cwd.ts"
import { assertValidCodeMSessionId } from "./shared/session/session-id.ts"
import { SessionImageAttachmentSchema, type SessionImageAttachment } from "./shared/session/attachment.ts"

/** Resolve only a schema-validated descriptor obtained from this session's JSONL. */
export async function readSessionImage(options: { sessionsRoot: string; cwd: string; threadId: string; attachment: SessionImageAttachment }): Promise<Buffer> {
  assertValidCodeMSessionId(options.threadId)
  const attachment = SessionImageAttachmentSchema.parse(options.attachment)
  const root = await realpath(options.sessionsRoot)
  const path = join(root, projectHashForCwd(options.cwd), options.threadId, attachment.path)
  if (await realpath(path) !== path) throw new Error("Session image must not traverse symlinks")
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size !== attachment.sizeBytes || before.size > 20 * 1024 * 1024) throw new Error("Invalid session image size")
    const bytes = Buffer.alloc(before.size)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    const after = await file.stat()
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || createHash("sha256").update(bytes).digest("hex") !== attachment.sha256) throw new Error("Session image integrity mismatch")
    return bytes
  } finally { await file.close() }
}
