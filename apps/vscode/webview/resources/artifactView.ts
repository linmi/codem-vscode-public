import type { ArtifactView, ViewAction } from "../../src/shared/messages.ts"
import { uiIcon } from "../../src/shared/uiIcons.ts"

export function artifactCard(item: ArtifactView, post: (action: ViewAction) => void): HTMLElement {
  const card = document.createElement("button"); card.type = "button"; card.className = "artifactCard"; card.disabled = !item.available; card.dataset.kind = item.kind
  const icon = document.createElement("span"); icon.className = "artifactIcon"; icon.innerHTML = uiIcon(item.kind === "url" ? "globe" : item.kind === "chart" ? "chart" : "file")
  const content = document.createElement("span")
  const title = document.createElement("strong"); title.textContent = item.title
  const detail = document.createElement("span"); detail.textContent = item.detail; detail.className = "artifactDetail"
  content.append(title, detail); card.append(icon, content)
  card.setAttribute("aria-label", `打开${item.kind === "diff" ? "差异" : "产物"} ${item.title}`)
  card.addEventListener("click", () => post({ type: item.kind === "diff" ? "openDiff" : "openArtifact", id: item.id }))
  return card
}
