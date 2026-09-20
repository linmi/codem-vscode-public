import { createRewindPanel } from "./rewindPanel.tsx"
import type { PanelReply, PanelView } from "../../src/shared/panelTypes.ts"
import { uiIcon } from "../../src/shared/uiIcons.ts"
import { renderMarkdown } from "../transcript/markdownView.ts"

const anchorIds = { rewind: "prompt", approval: "prompt", question: "prompt", plan: "prompt" } as const

export function createPanelView(post: (reply: PanelReply) => void, changed: () => void) {
  const footer = document.querySelector("footer")!
  const root = document.createElement("section"); root.className = "decisionPanel"; root.hidden = true; root.tabIndex = -1; root.setAttribute("role", "dialog"); root.setAttribute("aria-labelledby", "decisionTitle")
  footer.prepend(root)
  const rewindHost = document.createElement("div"); footer.prepend(rewindHost)
  const renderRewind = createRewindPanel(rewindHost, post)
  let current: PanelView | null = null
  let restore: HTMLElement | null = null
  let pending = false
  let cancel = () => {}
  const locked = () => current !== null
  function restoreFocus(): void {
    if (restore && !(restore as HTMLButtonElement).disabled) { restore.focus(); restore = null }
  }
  function render(panel: PanelView | null): void {
    if (panel?.id === current?.id) return
    const previous = current
    const ownedFocus = root.contains(document.activeElement)
    current = panel
    pending = false
    renderRewind(panel?.kind === "rewind" ? panel : null)
    root.hidden = !panel || panel.kind === "rewind"
    if (panel?.kind === "rewind") { root.replaceChildren(); changed(); return }
    if (!panel) {
      root.replaceChildren()
      if (previous && ownedFocus) restore = document.getElementById(anchorIds[previous.kind])
      changed(); restoreFocus(); return
    }
    restore = null
    root.dataset.kind = panel.kind
    root.replaceChildren()
    const heading = document.createElement("div"); heading.className = "decisionHeading"
    const title = document.createElement("h2"); title.id = "decisionTitle"; title.textContent = panel.title
    const close = document.createElement("button"); close.type = "button"; close.className = "iconButton"; close.innerHTML = uiIcon("close"); close.setAttribute("aria-label", "取消当前请求")
    heading.append(title, close); root.append(heading)
    if (panel.description) { const description = document.createElement("p"); description.className = "decisionDescription"; description.textContent = panel.description; root.append(description) }
    if (panel.detail) {
      const detail = document.createElement("div"); detail.className = "decisionDetail"
      if (panel.kind === "plan") { detail.classList.add("chatMarkdown"); renderMarkdown(detail, panel.detail) }
      else detail.textContent = panel.detail
      root.append(detail)
    }
    const list = document.createElement("div"); list.className = "decisionChoices"
    const selected = new Set(panel.choices.filter(choice => choice.selected).map(choice => choice.id))
    const input = document.createElement("textarea"); input.className = "decisionAnswer"; input.rows = 2; input.maxLength = 16000; input.placeholder = "输入自己的回答…"; input.setAttribute("aria-label", panel.kind === "plan" ? "修改意见" : "补充回答"); input.value = panel.initialText; input.placeholder = panel.kind === "plan" ? "需要调整的地方（可选）…" : "输入自己的回答…"
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = "decisionSubmit"; confirm.textContent = panel.confirmLabel
    function submit(choiceIds: string[], cancelled = false): void {
      if (pending || current?.id !== panel!.id) return
      pending = true
      for (const element of root.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement>("button,textarea,input")) element.disabled = true
      root.setAttribute("aria-busy", "true")
      post({ type: "panelReply", id: panel!.id, choiceIds, text: cancelled || !panel!.allowText || choiceIds.includes(panel!.backChoiceId ?? "") ? "" : input.value, cancelled })
    }
    cancel = () => submit([], true)
    close.addEventListener("click", cancel)
    const choices: HTMLButtonElement[] = []
    const syncSelection = () => {
      for (const choice of choices) {
        const active = selected.has(choice.dataset.id!)
        choice.setAttribute("aria-pressed", String(active)); choice.dataset.selected = String(active)
      }
      confirm.disabled = !selected.size && !input.value.trim()
    }
    for (const [index, option] of panel.choices.entries()) {
      const row = document.createElement("button"); row.type = "button"; row.className = "decisionChoice"; row.dataset.id = option.id
      const chip = document.createElement("span"); chip.className = "decisionNumber"; chip.textContent = String(index + 1)
      const content = document.createElement("span"); content.className = "decisionChoiceContent"
      const label = document.createElement("span"); label.className = "decisionLabel"; label.textContent = option.label; content.append(label)
      if (option.description) { const detail = document.createElement("span"); detail.className = "decisionChoiceDescription"; detail.textContent = option.description; content.append(detail) }
      const check = document.createElement("span"); check.className = "decisionCheck"; check.innerHTML = uiIcon("check")
      row.dataset.selected = String(option.selected); row.setAttribute("aria-pressed", String(option.selected))
      row.append(chip)
      if (option.icon) {
        const icon = document.createElement("span"); icon.className = "decisionChoiceIcon"; icon.innerHTML = uiIcon(option.icon)
        row.append(icon)
        row.classList.toggle("permissionWarning", option.icon === "shieldAlert")
      }
      row.append(content, check)
      row.addEventListener("click", () => {
        if (panel.confirmLabel) {
          if (selected.has(option.id)) selected.delete(option.id)
          else { if (!panel.multiple) selected.clear(); selected.add(option.id) }
          syncSelection()
        } else submit([option.id])
      })
      choices.push(row); list.append(row)
    }
    root.append(list)
    if (panel.allowText) { root.append(input); input.addEventListener("input", syncSelection) }
    const actions = document.createElement("div"); actions.className = "decisionActions"
    if (panel.confirmLabel) { actions.append(confirm); confirm.disabled = true; confirm.addEventListener("click", () => submit([...selected])) }
    root.onkeydown = event => {
      if (event.isComposing) return
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return }
      if (event.target instanceof HTMLTextAreaElement) return
      const visible = choices.filter(row => !row.hidden && !row.disabled)
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const index = visible.indexOf(document.activeElement as HTMLButtonElement)
        visible[(index + (event.key === "ArrowDown" ? 1 : visible.length - 1) + visible.length) % visible.length]?.focus()
      } else if (!(event.target instanceof HTMLInputElement) && locked() && /^[1-9]$/.test(event.key)) {
        event.preventDefault(); visible[Number(event.key) - 1]?.click()
      }
    }
    if (panel.backChoiceId) {
      const previous = document.createElement("button"); previous.type = "button"; previous.className = "decisionPrevious"; previous.textContent = "上一题"
      previous.addEventListener("click", () => submit([panel.backChoiceId!])); actions.prepend(previous)
    }
    if (actions.childElementCount) root.append(actions)
    if (panel.confirmLabel) syncSelection()
    root.removeAttribute("aria-busy")
    changed()
    root.focus()
  }
  return { render, locked, restoreFocus, kind: () => current?.kind ?? null }
}
