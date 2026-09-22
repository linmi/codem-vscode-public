import { useEffect, useState } from "react"
import type { AttachmentView } from "../contract.ts"
import { uiIcon } from "./uiIcons.ts"

/** 对照 VS Code attachmentView：延迟加载、缩略图和原始尺寸预览。 */
export function AttachmentCard({ item, disabled, post }: { item: AttachmentView; disabled: boolean; post: (action: Record<string, unknown>) => void }) {
  const [preview, setPreview] = useState(item.preview ?? { kind: "none" as const })
  const [loading, setLoading] = useState(false)
  useEffect(() => setPreview(item.preview ?? { kind: "none" }), [item.preview])
  const load = () => {
    if (loading || preview.kind === "image") return
    setLoading(true)
    post({ type: "loadImage", id: item.id })
  }
  return (
    <span className="attachmentCard">
      {preview.kind === "deferred" ? (
        <button type="button" className="attachmentLoad" disabled={disabled || loading} aria-label={`${loading ? "加载中" : "加载图片"} ${item.label}`} onClick={load}>{loading ? "加载中…" : "加载图片"}</button>
      ) : null}
      {preview.kind === "image" ? (
        <button type="button" className="attachmentPreview" aria-label={`预览 ${item.label}`} onClick={(event) => openPreview(item.label, preview.dataUrl, event.currentTarget)}>
          <img src={preview.dataUrl} alt={item.label} className="attachmentThumbnail" />
        </button>
      ) : null}
      {preview.kind !== "image" && preview.kind !== "deferred" ? <span dangerouslySetInnerHTML={{ __html: uiIcon(item.kind === "directory" ? "folder" : "file") }} /> : null}
      <span className="attachmentName" title={preview.kind === "unavailable" ? preview.reason : item.label}>{item.label}</span>
      <button type="button" className="attachmentRemove" disabled={disabled} aria-label={`移除附件 ${item.label}`} onClick={() => post({ type: "removeAttachment", id: item.id })} dangerouslySetInnerHTML={{ __html: uiIcon("close") }} />
    </span>
  )
}

function openPreview(label: string, src: string, opener: HTMLElement): void {
  const dialog = document.createElement("dialog")
  dialog.className = "imagePreview"
  dialog.setAttribute("aria-label", label)
  const image = document.createElement("img")
  image.src = src
  image.alt = label
  image.className = "previewImage"
  const viewport = document.createElement("div")
  viewport.className = "imageViewport"
  viewport.append(image)
  const zoom = document.createElement("button")
  zoom.type = "button"
  zoom.textContent = "原始尺寸"
  zoom.setAttribute("aria-pressed", "false")
  zoom.addEventListener("click", () => {
    const original = dialog.classList.toggle("originalSize")
    zoom.textContent = original ? "适应窗口" : "原始尺寸"
    zoom.setAttribute("aria-pressed", String(original))
  })
  const close = document.createElement("button")
  close.type = "button"
  close.textContent = "关闭预览"
  close.addEventListener("click", () => dialog.close())
  const toolbar = document.createElement("div")
  toolbar.className = "imagePreviewActions"
  toolbar.append(zoom, close)
  dialog.append(viewport, toolbar)
  document.body.append(dialog)
  dialog.addEventListener("close", () => { dialog.remove(); opener.focus() }, { once: true })
  dialog.showModal()
}
