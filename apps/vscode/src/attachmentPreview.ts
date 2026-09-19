import { open } from "node:fs/promises"
import type { AppServerPromptAttachment } from "@codem/app-server"
import type { AttachmentView } from "./messages.ts"

/** Bounded user-selected raster bytes only; no SVG, external URLs or host paths. */
export async function attachmentPreview(item: AppServerPromptAttachment): Promise<AttachmentView["preview"]> {
  if (item.kind !== "image") return { kind: "none" }
  const file = await open(item.path, "r")
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error("Attachment is not a file")
    if (info.size > 20 * 1024 * 1024) return { kind: "unavailable", reason: "图片超过 20 MiB，无法预览" }
    const bytes = Buffer.alloc(info.size)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== bytes.length) throw new Error("Attachment changed during preview")
    return rasterPreview(bytes)
  } finally { await file.close() }
}

export function rasterPreview(bytes: Buffer): AttachmentView["preview"] {
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) ? "image/gif" : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null
  return mime ? { kind: "image", dataUrl: `data:${mime};base64,${bytes.toString("base64")}` } : { kind: "unavailable", reason: "此格式不支持安全缩略图" }
}
