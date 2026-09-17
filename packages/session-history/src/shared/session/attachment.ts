import { z } from 'zod'

const SUFFIX_HEADER = '\n\n[codem-local-references:v1]\n'
const DATA_LINE_PREFIX = '[codem-local-references-data:'
const LENGTH_LINE_PREFIX = '[codem-local-references-end:'
const LINE_SUFFIX = ']'

const PromptAttachmentPathSchema = z.string().superRefine((value, context) => {
  const issue = (message: string): void => {
    context.addIssue({ code: 'custom', message })
  }

  if (!value) {
    issue('Prompt attachment path must be non-empty')
    return
  }
  if (/^[A-Za-z]:/.test(value) || value.startsWith('/')) {
    issue('Prompt attachment path must be cwd-relative')
  }
  if (value.includes('\\')) {
    issue('Prompt attachment path must use POSIX separators')
  }
  if (
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
    })
  ) {
    issue('Prompt attachment path must not contain control characters')
  }
  if (value !== '.') {
    const segments = value.split('/')
    if (
      value.startsWith('./') ||
      value.endsWith('/') ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      issue('Prompt attachment path must be a normalized POSIX path without traversal')
    }
  }
})

const PromptAttachmentLeafPathSchema = PromptAttachmentPathSchema.refine(
  (value) => value !== '.',
  'File and image attachment paths must identify a cwd descendant',
)

export const FilePromptAttachmentSchema = z.strictObject({
  kind: z.literal('file'),
  path: PromptAttachmentLeafPathSchema,
}).readonly()

export const DirectoryPromptAttachmentSchema = z.strictObject({
  kind: z.literal('directory'),
  path: PromptAttachmentPathSchema,
}).readonly()

export const ImagePromptAttachmentSchema = z.strictObject({
  kind: z.literal('image'),
  path: PromptAttachmentLeafPathSchema,
}).readonly()

export const PromptAttachmentSchema = z.discriminatedUnion('kind', [
  FilePromptAttachmentSchema,
  DirectoryPromptAttachmentSchema,
  ImagePromptAttachmentSchema,
])

export const PromptAttachmentListSchema = z.array(PromptAttachmentSchema)
  .superRefine((attachments, context) => {
    const seenPaths = new Set<string>()
    for (const [index, attachment] of attachments.entries()) {
      if (seenPaths.has(attachment.path)) {
        context.addIssue({
          code: 'custom',
          message: `Prompt attachment path is duplicated: ${attachment.path}`,
          path: [index, 'path'],
        })
      }
      seenPaths.add(attachment.path)
    }
  })
  .readonly()

export type FilePromptAttachment = z.infer<typeof FilePromptAttachmentSchema>
export type DirectoryPromptAttachment = z.infer<
  typeof DirectoryPromptAttachmentSchema
>
export type ImagePromptAttachment = z.infer<typeof ImagePromptAttachmentSchema>
export type PromptAttachment = z.infer<typeof PromptAttachmentSchema>

const IMPORTED_ATTACHMENT_DISPLAY_NAME_PATTERN =
  /^\.codem\/attachments\/[0-9a-f-]+\/\d{2}-(.+)$/iu

export function promptAttachmentDisplayName(
  attachment: PromptAttachment,
): string {
  const importedName = IMPORTED_ATTACHMENT_DISPLAY_NAME_PATTERN.exec(
    attachment.path,
  )?.[1]
  if (importedName) return importedName
  const segments = attachment.path.split('/')
  return segments.at(-1) ?? attachment.path
}

export function promptAttachmentFormat(
  attachment: PromptAttachment,
): string {
  if (attachment.kind === 'directory') return 'FOLDER'
  const displayName = promptAttachmentDisplayName(attachment)
  const extensionStart = displayName.lastIndexOf('.')
  if (extensionStart > 0 && extensionStart < displayName.length - 1) {
    return displayName.slice(extensionStart + 1).toLocaleUpperCase()
  }
  return attachment.kind === 'image' ? 'IMAGE' : 'FILE'
}

export interface DecodedPromptAttachments {
  readonly body: string
  readonly attachments: readonly PromptAttachment[]
}

export class PromptAttachmentCodecError extends Error {
  constructor(detail: string, options?: ErrorOptions) {
    super(`Invalid CodeM prompt attachment suffix: ${detail}`, options)
    this.name = 'PromptAttachmentCodecError'
  }
}

export function encodePromptAttachments(
  body: string,
  attachments: readonly PromptAttachment[],
): string {
  const parsedAttachments = PromptAttachmentListSchema.parse(attachments)
  if (parsedAttachments.length === 0 && !body.includes(SUFFIX_HEADER)) {
    return body
  }

  return renderEncodedPrompt(
    body,
    parsedAttachments,
    attachmentTokenLine(parsedAttachments),
  )
}

export function decodePromptAttachments(prompt: string): DecodedPromptAttachments {
  const suffixStart = prompt.lastIndexOf(SUFFIX_HEADER)
  if (suffixStart === -1) return { body: prompt, attachments: [] }

  const suffixLines = prompt.slice(suffixStart + SUFFIX_HEADER.length).split('\n')
  if (suffixLines.length !== 3) {
    throw codecError('suffix must contain exactly three lines')
  }
  const [, dataLine, lengthLine] = suffixLines
  const encodedData = unwrapLine(dataLine, DATA_LINE_PREFIX, 'data')
  const encodedBodyLength = unwrapLine(lengthLine, LENGTH_LINE_PREFIX, 'end')
  if (!/^(?:0|[1-9]\d*)$/.test(encodedBodyLength)) {
    throw codecError('body length must be a canonical non-negative integer')
  }
  const bodyLength = Number(encodedBodyLength)
  if (!Number.isSafeInteger(bodyLength) || bodyLength !== suffixStart) {
    throw codecError('body length does not match the suffix boundary')
  }

  const attachments = parseEncodedAttachments(encodedData)
  const body = prompt.slice(0, suffixStart)
  const canonicalPrompt = encodePromptAttachments(body, attachments)
  const cliPersistedPrompt = renderEncodedPrompt(
    body,
    attachments,
    cliPersistedAttachmentTokenLine(attachments),
  )
  if (canonicalPrompt !== prompt && cliPersistedPrompt !== prompt) {
    throw codecError('suffix is not the canonical attachment encoding')
  }
  return { body, attachments }
}

export function promptWithAttachmentReferences(
  body: string,
  attachments: readonly PromptAttachment[],
): string {
  const parsedAttachments = PromptAttachmentListSchema.parse(attachments)
  return [
    ...(body ? [body] : []),
    ...parsedAttachments.map((attachment) =>
      cliFileReferenceToken(attachment.path),
    ),
  ].join('\n')
}

function parseEncodedAttachments(
  encodedData: string,
): readonly PromptAttachment[] {
  let value: unknown
  try {
    value = JSON.parse(decodeURIComponent(encodedData))
  } catch (error: unknown) {
    throw codecError('data is not valid URI-encoded JSON', error)
  }
  const parsed = PromptAttachmentListSchema.safeParse(value)
  if (!parsed.success) {
    throw codecError('data does not match the attachment schema', parsed.error)
  }
  return parsed.data
}

function unwrapLine(
  line: string | undefined,
  prefix: string,
  label: string,
): string {
  if (!line?.startsWith(prefix) || !line.endsWith(LINE_SUFFIX)) {
    throw codecError(`${label} line is malformed`)
  }
  return line.slice(prefix.length, -LINE_SUFFIX.length)
}

function attachmentTokenLine(
  attachments: readonly PromptAttachment[],
): string {
  return attachments
    .map((attachment) => cliFileReferenceToken(attachment.path))
    .join(' ')
}

function cliPersistedAttachmentTokenLine(
  attachments: readonly PromptAttachment[],
): string {
  return attachments
    .map((attachment) =>
      attachment.kind === 'image'
        ? ' '
        : cliFileReferenceToken(attachment.path),
    )
    .join(' ')
}

function renderEncodedPrompt(
  body: string,
  attachments: readonly PromptAttachment[],
  tokenLine: string,
): string {
  const encodedData = encodeURIComponent(JSON.stringify(attachments))
  return [
    body,
    SUFFIX_HEADER,
    tokenLine,
    '\n',
    DATA_LINE_PREFIX,
    encodedData,
    LINE_SUFFIX,
    '\n',
    LENGTH_LINE_PREFIX,
    String(body.length),
    LINE_SUFFIX,
  ].join('')
}

function cliFileReferenceToken(path: string): string {
  return /\s|"/.test(path) ? `@${JSON.stringify(path)}` : `@${path}`
}

function codecError(detail: string, cause?: unknown): PromptAttachmentCodecError {
  return new PromptAttachmentCodecError(detail, { cause })
}

const SessionAttachmentPathSchema = z.string().superRefine((value, context) => {
  const segments = value.split('/')
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
  })
  if (
    !value.startsWith('attachments/') ||
    value.startsWith('/') ||
    value.includes('\\') ||
    hasControlCharacter ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Session attachment path must be normalized under attachments/',
    })
  }
})

export const SessionImageAttachmentSchema = z.strictObject({
  kind: z.literal('session-image'),
  path: SessionAttachmentPathSchema,
  sha256: z.string().regex(
    /^[0-9a-f]{64}$/u,
    'Session image attachment sha256 must be lowercase hexadecimal',
  ),
  mediaType: z.enum([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
  ]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sizeBytes: z.number().int().nonnegative(),
  displayName: z.string().refine((value) => value.trim().length > 0, {
    error: 'Session image attachment displayName must be non-empty',
  }),
}).readonly()

export const ConversationAttachmentSchema = z.union([
  PromptAttachmentSchema,
  SessionImageAttachmentSchema,
])

export const ConversationAttachmentListSchema = z.array(
  ConversationAttachmentSchema,
).superRefine((attachments, context) => {
  const workspacePaths = new Set<string>()
  for (const [index, attachment] of attachments.entries()) {
    if (attachment.kind === 'session-image') continue
    if (workspacePaths.has(attachment.path)) {
      context.addIssue({
        code: 'custom',
        message: `Workspace conversation attachment path is duplicated: ${attachment.path}`,
        path: [index, 'path'],
      })
    }
    workspacePaths.add(attachment.path)
  }
}).readonly()

export type SessionImageAttachment = z.infer<
  typeof SessionImageAttachmentSchema
>
export type ConversationAttachment = z.infer<
  typeof ConversationAttachmentSchema
>

export function isPromptAttachment(
  attachment: ConversationAttachment,
): attachment is PromptAttachment {
  return attachment.kind !== 'session-image'
}

export function conversationAttachmentDisplayName(
  attachment: ConversationAttachment,
): string {
  return attachment.kind === 'session-image'
    ? attachment.displayName
    : promptAttachmentDisplayName(attachment)
}

export function conversationAttachmentFormat(
  attachment: ConversationAttachment,
): string {
  if (attachment.kind !== 'session-image') {
    return promptAttachmentFormat(attachment)
  }
  const extensionStart = attachment.displayName.lastIndexOf('.')
  return extensionStart > 0 && extensionStart < attachment.displayName.length - 1
    ? attachment.displayName.slice(extensionStart + 1).toLocaleUpperCase()
    : attachment.mediaType.slice('image/'.length).toLocaleUpperCase()
}
