import type { AttachmentView } from "../src/messages.ts"
import { uiIcon } from "../src/uiIcons.ts"

let loadImage: (id: string) => Promise<AttachmentView["preview"]> = async () => ({ kind: "unavailable", reason: "预览尚未就绪" })
export function configureImageLoader(load: typeof loadImage): void { loadImage = load }

export function attachmentCard(item: AttachmentView, remove?: () => void): HTMLElement {
  const card = document.createElement("span"); card.className = "attachmentCard"
  if (item.preview.kind === "deferred") {
    const load = document.createElement("button"); load.type = "button"; load.className = "attachmentLoad"; load.textContent = "加载图片"; load.setAttribute("aria-label", `加载图片 ${item.label}`)
    let loading = false
    const preview = async () => {
      if (loading || !card.isConnected) return
      loading = true; load.disabled = true; load.textContent = "加载中…"
      const result = await loadImage(item.id)
      if (!card.isConnected) return
      if (result.kind === "image") card.replaceWith(attachmentCard({ ...item, preview: result }, remove))
      else { load.disabled = false; loading = false; load.textContent = "重试图片"; card.title = result.kind === "unavailable" ? result.reason : "图片暂不可用" }
    }
    load.addEventListener("click", () => { void preview() }); card.append(load)
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void preview() } })
    observer.observe(card)
  } else if (item.preview.kind === "image") {
    const image = document.createElement("img"); image.src = item.preview.dataUrl; image.alt = item.label; image.className = "attachmentThumbnail"
    const preview = document.createElement("button"); preview.type = "button"; preview.className = "attachmentPreview"; preview.setAttribute("aria-label", `预览 ${item.label}`); preview.append(image)
    image.addEventListener("error", () => { preview.disabled = true; preview.textContent = "图片无法解码"; preview.title = "图片内容损坏或格式不受支持" })
    preview.addEventListener("click", () => {
      const dialog = document.createElement("dialog"); dialog.className = "imagePreview"
      const full = image.cloneNode(true) as HTMLImageElement
      const close = document.createElement("button"); close.type = "button"; close.textContent = "关闭预览"; close.addEventListener("click", () => dialog.close())
      full.className = "previewImage"
      const zoom = document.createElement("button"); zoom.type = "button"; zoom.textContent = "原始尺寸"; zoom.setAttribute("aria-pressed", "false")
      zoom.addEventListener("click", () => { const original = dialog.classList.toggle("originalSize"); zoom.textContent = original ? "适应窗口" : "原始尺寸"; zoom.setAttribute("aria-pressed", String(original)) })
      const toolbar = document.createElement("div"); toolbar.className = "imagePreviewActions"; toolbar.append(zoom, close)
      const viewport = document.createElement("div"); viewport.className = "imageViewport"; viewport.append(full)
      dialog.setAttribute("aria-label", item.label)
      dialog.append(viewport, toolbar); document.body.append(dialog)
      dialog.addEventListener("close", () => { dialog.remove(); preview.focus() }, { once: true }); dialog.showModal()
    })
    card.append(preview)
  } else {
    const icon = document.createElement("span"); icon.innerHTML = uiIcon(item.kind === "directory" ? "folder" : "file"); card.append(icon)
  }
  const label = document.createElement("span"); label.className = "attachmentName"; label.textContent = item.label; label.title = item.label; card.append(label)
  if (item.preview.kind === "unavailable") card.title = item.preview.reason
  if (remove) { const button = document.createElement("button"); button.type = "button"; button.className = "attachmentRemove"; button.innerHTML = uiIcon("close"); button.setAttribute("aria-label", `移除附件 ${item.label}`); button.addEventListener("click", remove); card.append(button) }
  return card
}
