/** One paste is bounded before decoding or crossing the Webview boundary. */
export const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_ATTACHMENTS = 20
export const pastedImageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const
export type PastedImageType = typeof pastedImageTypes[number]
export interface PastedImage { mediaType: PastedImageType; data: string }
export interface PasteImagesAction { type: "pasteImages"; requestId: string; scope: string; images: readonly PastedImage[] }
export interface PasteImagesResult { type: "pasteImagesResult"; requestId: string; error: string | null }

export function attachmentScope(state: { workspace: string | null; space: string | null; threadId: string | null }): string {
  return JSON.stringify([state.workspace, state.space, state.threadId])
}

export function parsePastedImages(value: unknown): PastedImage[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_ATTACHMENTS) throw new Error("Invalid pasted image count")
  let bytes = 0
  return value.map(item => {
    if (!item || typeof item !== "object" || Object.keys(item).length !== 2 || !pastedImageTypes.includes(item.mediaType) || typeof item.data !== "string" || !item.data.length || item.data.length > Math.ceil(MAX_PASTED_IMAGE_BYTES / 3) * 4 || item.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) throw new Error("Invalid pasted image")
    bytes += item.data.length / 4 * 3 - (item.data.endsWith("==") ? 2 : item.data.endsWith("=") ? 1 : 0)
    if (bytes > MAX_PASTED_IMAGE_BYTES) throw new Error("Pasted images exceed 20 MiB")
    return { mediaType: item.mediaType, data: item.data }
  })
}
