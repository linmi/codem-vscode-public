import {
  decodePromptAttachments,
  type ConversationAttachment,
} from "../../session/index.ts"
import {
  requireNonEmptyString,
  requireString,
  requireTimestamp,
} from "./fields.ts"
import { sessionFileError } from "./jsonl.ts"
import { parseSessionImageAttachments } from "./session-image-attachments.ts"

const LEGACY_HOST_ENVELOPE = {
  open: '<codem_mac_client_host_instructions>',
  close: '</codem_mac_client_host_instructions>',
}
const LEGACY_PLAN_ENVELOPE = {
  open: '<codem_mac_plan_mode>',
  close: '</codem_mac_plan_mode>',
}

export type DecodedPersistedUserMessage =
  | { readonly visibility: 'visible'; readonly text: string }
  | {
      readonly visibility: 'synthetic'
      readonly source: 'legacy-control-only'
    }

export interface ParsedLegacyUserMessage {
  readonly startedAt: string
  readonly text: string
  readonly attachments: readonly ConversationAttachment[]
}

export function parseLegacyUserMessage(
  record: Record<string, unknown>,
  path: string,
  lineNumber: number,
): ParsedLegacyUserMessage | null {
  const startedAt = requireTimestamp(record.at, path, lineNumber, 'at')
  const encodedPrompt = requireNonEmptyString(
    record.content,
    path,
    lineNumber,
    'content',
  )
  let decodedPrompt
  try {
    decodedPrompt = decodePromptAttachments(encodedPrompt)
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    throw sessionFileError(
      path,
      lineNumber,
      `invalid structured prompt attachments: ${detail}`,
    )
  }
  const nativeAttachments = parseSessionImageAttachments(
    record.attachments,
    path,
    lineNumber,
  )
  // Core v3+ owns durable image payloads in the session sidecar. When both
  // representations exist, record-native refs replace only encoded images.
  const attachments: readonly ConversationAttachment[] =
    nativeAttachments.length > 0
      ? [
          ...decodedPrompt.attachments.filter(
            (attachment) => attachment.kind !== 'image',
          ),
          ...nativeAttachments,
        ]
      : decodedPrompt.attachments
  const decodedMessage = decodePersistedUserMessage(requireString(
    decodedPrompt.body,
    path,
    lineNumber,
    'decoded prompt body',
  ))
  if (decodedMessage.visibility === 'synthetic' && attachments.length === 0) {
    return null
  }
  const text = decodedMessage.visibility === 'visible'
    ? decodedMessage.text
    : ''
  if (!text.trim() && attachments.length === 0) {
    throw sessionFileError(
      path,
      lineNumber,
      'decoded user message requires text or an attachment',
    )
  }
  return { startedAt, text, attachments }
}

/**
 * Decodes the complete leading control-envelope chain emitted by the retired
 * macOS client, which is external transcript metadata rather than user text.
 * Malformed, incomplete, reordered, or non-leading legacy tags are preserved.
 */
export function decodePersistedUserMessage(
  text: string,
): DecodedPersistedUserMessage {
  const decodedLegacy = decodeLegacyControlPrefix(text)
  if (decodedLegacy === null) return { visibility: 'visible', text }
  if (decodedLegacy.trim()) {
    return { visibility: 'visible', text: decodedLegacy }
  }
  return { visibility: 'synthetic', source: 'legacy-control-only' }
}

function decodeLegacyControlPrefix(text: string): string | null {
  const leadingWhitespaceLength = text.length - text.trimStart().length
  let offset = leadingWhitespaceLength
  let decodedEnvelope = false
  let decodedHostEnvelope = false

  const hostEnd = completeEnvelopeEnd(text, offset, LEGACY_HOST_ENVELOPE)
  if (hostEnd === 'incomplete') return null
  if (hostEnd !== null) {
    decodedEnvelope = true
    decodedHostEnvelope = true
    offset = skipWhitespace(text, hostEnd)
  }

  const planEnd = completeEnvelopeEnd(text, offset, LEGACY_PLAN_ENVELOPE)
  if (planEnd === 'incomplete') return null
  if (planEnd !== null) {
    decodedEnvelope = true
    offset = skipWhitespace(text, planEnd)
    if (
      !decodedHostEnvelope &&
      text.startsWith(LEGACY_HOST_ENVELOPE.open, offset)
    ) {
      return null
    }
  }

  return decodedEnvelope ? text.slice(offset) : null
}

function completeEnvelopeEnd(
  text: string,
  offset: number,
  envelope: { readonly open: string; readonly close: string },
): number | 'incomplete' | null {
  if (!text.startsWith(envelope.open, offset)) return null
  const closeIndex = text.indexOf(envelope.close, offset + envelope.open.length)
  return closeIndex < 0 ? 'incomplete' : closeIndex + envelope.close.length
}

function skipWhitespace(text: string, offset: number): number {
  const suffix = text.slice(offset)
  return offset + (suffix.length - suffix.trimStart().length)
}
