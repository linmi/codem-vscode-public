/** 与 Host 粘贴校验一致的图片类型与上限。 */
export const IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_DROPPED_URIS = 20

/** VS Code 资源管理器与编辑器标签拖出的是 URI 列表；系统文件管理器拖出的是 File。 */
const uriTypes = ["application/vnd.code.uri-list", "text/uri-list"] as const

export type DroppedAttachments =
  | { kind: "uris"; uris: string[] }
  | { kind: "images"; files: File[] }
  | { kind: "rejected"; reason: string }
  | { kind: "none" }

/** dragenter/dragover 只能看类型，看不到内容；有文件或 URI 列表才接管拖拽。 */
export function carriesAttachments(types: readonly string[]): boolean {
  return types.includes("Files") || uriTypes.some((type) => types.includes(type))
}

/** 只认 file: 地址；是否在工作区内由 Host 判断。 */
export function parseUriList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && /^file:\/\//i.test(line) && line.length <= 4096)
}

export function readDroppedAttachments(transfer: Pick<DataTransfer, "getData" | "files">): DroppedAttachments {
  for (const type of uriTypes) {
    const uris = [...new Set(parseUriList(transfer.getData(type)))]
    if (uris.length > MAX_DROPPED_URIS) return { kind: "rejected", reason: `一次最多拖入 ${MAX_DROPPED_URIS} 个文件。` }
    if (uris.length) return { kind: "uris", uris }
  }
  const files = Array.from(transfer.files ?? [])
  if (files.length === 0) return { kind: "none" }
  if (files.some((file) => !IMAGE_TYPES.has(file.type))) {
    return { kind: "rejected", reason: "从系统文件夹只能直接拖入 PNG、JPEG、GIF、WebP 图片；其他文件请用“添加附件”选择。" }
  }
  if (files.some((file) => file.size === 0)) return { kind: "rejected", reason: "拖入的图片是空文件。" }
  if (files.reduce((size, file) => size + file.size, 0) > MAX_IMAGE_BYTES) return { kind: "rejected", reason: "图片合计不能超过 20 MiB。" }
  return { kind: "images", files }
}

/** 粘贴与拖入共用：读成 base64，交给 Host 的 pasteImages 校验并落盘。 */
export function readImageFiles(files: readonly File[]): Promise<{ mediaType: string; data: string }[]> {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<{ mediaType: string; data: string }>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const value = String(reader.result ?? "")
            resolve({ mediaType: file.type, data: value.slice(value.indexOf(",") + 1) })
          }
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        }),
    ),
  )
}
