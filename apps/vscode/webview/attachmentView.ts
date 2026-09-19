import type { AttachmentView } from "../src/messages.ts"
import { uiIcon } from "../src/uiIcons.ts"

export function attachmentCard(item: AttachmentView, remove?: () => void): HTMLElement {
  const card = document.createElement("span"); card.className = "attachmentCard"
  if (item.preview.kind === "image") {
    const image = document.createElement("img"); image.src = item.preview.dataUrl; image.alt = item.label; image.className = "attachmentThumbnail"
    const preview = document.createElement("button"); preview.type = "button"; preview.className = "attachmentPreview"; preview.setAttribute("aria-label", `预览 ${item.label}`); preview.append(image)
    preview.addEventListener("click", () => {
      const dialog = document.createElement("dialog"); dialog.className = "imagePreview"
      const full = image.cloneNode(true) as HTMLImageElement
      const close = document.createElement("button"); close.type = "button"; close.textContent = "关闭预览"; close.addEventListener("click", () => dialog.close())
      dialog.append(full, close); document.body.append(dialog)
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
