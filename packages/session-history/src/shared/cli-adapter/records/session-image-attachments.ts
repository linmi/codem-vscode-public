import {
  SessionImageAttachmentSchema,
  type SessionImageAttachment,
} from "../../session/index.ts"
import { sessionFileError } from "./jsonl.ts"

export function parseSessionImageAttachments(
  value: unknown,
  path: string,
  lineNumber: number,
): readonly SessionImageAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw sessionFileError(path, lineNumber, 'attachments must be an array')
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw sessionFileError(
        path,
        lineNumber,
        `attachments[${index}] must be an object`,
      )
    }
    const raw = entry as Record<string, unknown>
    const parsed = SessionImageAttachmentSchema.safeParse({
      kind: raw.kind === 'image' ? 'session-image' : raw.kind,
      path: raw.path,
      sha256: raw.sha256,
      mediaType: raw.media_type,
      width: raw.width,
      height: raw.height,
      sizeBytes: raw.bytes,
      displayName: raw.display_name,
    })
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'attachment'}: ${issue.message}`)
        .join('; ')
      throw sessionFileError(
        path,
        lineNumber,
        `invalid attachments[${index}]: ${detail}`,
      )
    }
    return parsed.data
  })
}
