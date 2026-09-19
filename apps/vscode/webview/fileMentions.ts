import type { FileSearchResult, FileSelected, ViewAction } from "../src/messages.ts"

export function installFileMentions(prompt: HTMLTextAreaElement, ready: () => boolean, post: (action: ViewAction) => void) {
  const menu = document.createElement("div"); menu.className = "composerCommands fileMentions"; menu.hidden = true; menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", "引用工作区文件")
  prompt.parentElement!.append(menu)
  let requestId = "", selecting = "", start = 0, end = 0, draft = "", index = 0
  let entries: HTMLButtonElement[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const close = () => { clearTimeout(timer); requestId = ""; menu.hidden = true; prompt.removeAttribute("aria-activedescendant") }
  const status = (text: string) => { const label = document.createElement("div"); label.className = "fileSearchStatus"; label.setAttribute("role", "status"); label.textContent = text; menu.replaceChildren(label); entries = []; menu.hidden = false }
  const highlight = () => { entries.forEach((entry, i) => entry.setAttribute("aria-selected", String(i === index))); entries[index]?.scrollIntoView({ block: "nearest" }) }
  function search(): void {
    close()
    if (!ready() || selecting || prompt.selectionStart !== prompt.selectionEnd) return
    const match = /(?:^|\s)@([^\s@]*)$/.exec(prompt.value.slice(0, prompt.selectionStart))
    if (!match || match[1]!.length > 200) return
    end = prompt.selectionStart; start = end - match[1]!.length - 1; draft = prompt.value
    requestId = crypto.randomUUID(); const id = requestId
    status("正在搜索工作区文件…")
    timer = setTimeout(() => post({ type: "searchFiles", query: match[1]!, requestId: id }), 150)
  }
  prompt.addEventListener("input", search)
  prompt.addEventListener("click", search)
  prompt.addEventListener("keydown", event => {
    if (menu.hidden || event.isComposing || !["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return
    event.preventDefault(); event.stopImmediatePropagation()
    if (event.key === "Escape") close()
    else if (event.key === "Enter") entries[index]?.click()
    else if (entries.length) { index = (index + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length; highlight() }
  }, true)
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target as Node) && event.target !== prompt) close() })
  return {
    refresh(): void { if (!ready() && !selecting) close() },
    receive(message: FileSearchResult | FileSelected): void {
      if (message.type === "fileSelected") {
        if (message.requestId !== selecting) return
        selecting = ""
        if (message.accepted) {
          close()
          if (prompt.value === draft) { prompt.setRangeText("", start, end, "end"); prompt.dispatchEvent(new Event("input", { bubbles: true })) }
          prompt.focus()
        } else status("文件已变化或搜索结果已过期，请重新输入 @ 搜索。")
        return
      }
      if (message.requestId !== requestId || !ready() || prompt.value !== draft) return
      if (message.error || !message.files.length) { status(message.error ?? "没有匹配的文件"); return }
      entries = message.files.map(file => {
        const button = document.createElement("button"); button.type = "button"; button.setAttribute("role", "option"); button.textContent = file.label
        button.addEventListener("click", () => { if (selecting || !ready()) return; selecting = crypto.randomUUID(); status("正在添加引用…"); post({ type: "selectFile", id: file.id, requestId: selecting }) })
        return button
      })
      menu.replaceChildren(...entries); index = 0; highlight()
    },
  }
}
