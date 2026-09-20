import { attachmentScope, MAX_ATTACHMENTS, MAX_PASTED_IMAGE_BYTES, pastedImageTypes, type PastedImage, type PastedImageType, type PasteImagesResult, type PasteImagesAction } from "../../src/shared/pastedImages.ts"
import type { ChatSnapshot } from "../../src/shared/messages.ts"

/** Clipboard bytes live only for this paste; attachment handles and files belong to Host. */
export function installImagePaste(prompt: HTMLTextAreaElement, context: () => { state: ChatSnapshot; messageMode: boolean; blocked: boolean }, post: (action: PasteImagesAction) => void, status: (text: string | null) => void, changed: () => void) {
  let scope = attachmentScope(context().state)
  let pending: { id: string; abort: AbortController } | null = null

  function sync(): void {
    const current = context()
    const next = attachmentScope(current.state)
    if (scope === next && current.messageMode && !current.blocked) return
    scope = next
    pending?.abort.abort(); pending = null
    status(null)
  }
  function read(file: File, signal: AbortSignal): Promise<PastedImage> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      const abort = () => reader.abort()
      signal.addEventListener("abort", abort, { once: true })
      reader.onloadend = () => {
        signal.removeEventListener("abort", abort)
        if (signal.aborted || reader.error || typeof reader.result !== "string") reject(new Error("无法读取剪贴板图片，请重新复制后重试。"))
        else resolve({ mediaType: file.type as PastedImageType, data: reader.result.slice(reader.result.indexOf(",") + 1) })
      }
      reader.readAsDataURL(file)
      if (signal.aborted) reader.abort()
    })
  }
  prompt.addEventListener("paste", event => {
    const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith("image/"))
    if (!files.length) return // Native text paste, selection and undo remain untouched.
    if (!event.clipboardData?.getData("text/plain")) event.preventDefault()
    sync()
    const { state, messageMode, blocked } = context()
    if (!messageMode || blocked) { status("请在消息输入框中粘贴图片。"); return }
    if (pending || !["ready", "disconnected"].includes(state.phase) || state.backgroundBusy || state.sessionTools.busy) { status("请等待当前操作完成后再粘贴图片。"); return }
    if (files.some(file => !pastedImageTypes.includes(file.type as PastedImageType) || !file.size)) { status("请复制 PNG、JPEG、GIF 或 WebP 图片。"); return }
    if (state.attachments.length + files.length > MAX_ATTACHMENTS) { status("每条消息最多添加 20 个附件。"); return }
    if (files.reduce((size, file) => size + file.size, 0) > MAX_PASTED_IMAGE_BYTES) { status("单次粘贴的图片合计不能超过 20 MiB。"); return }
    const request = { id: crypto.randomUUID(), abort: new AbortController() }
    pending = request
    status("正在粘贴图片…"); changed()
    void (async () => {
      try {
        const images: PastedImage[] = []
        for (const file of files) images.push(await read(file, request.abort.signal))
        sync()
        if (pending !== request) return
        post({ type: "pasteImages", requestId: request.id, scope, images })
      } catch {
        if (pending !== request) return
        pending = null; status("无法读取剪贴板图片，请重新复制后重试。"); changed()
      }
    })()
  })
  return {
    get busy(): boolean { return pending !== null },
    sync,
    receive(result: PasteImagesResult): void {
      if (result.requestId !== pending?.id) return
      pending = null; status(result.error); changed()
    },
  }
}
