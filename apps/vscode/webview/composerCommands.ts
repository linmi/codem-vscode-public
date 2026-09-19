import type { ViewAction } from "../src/messages.ts"

/** Local UI commands only. No invented Core slash-command catalog. */
export function installComposerCommands(prompt: HTMLTextAreaElement, ready: () => boolean, run: (action: ViewAction) => void) {
  const commands = [
    { name: "/files", label: "引用文件、图片或目录", action: "addAttachment" },
    { name: "/model", label: "选择模型", action: "selectModel" },
    { name: "/mode", label: "切换 Agent / Plan", action: "selectWorkMode" },
    { name: "/history", label: "打开历史会话", action: "showHistory" },
  ] as const
  const menu = document.createElement("div"); menu.className = "composerCommands"; menu.hidden = true; menu.setAttribute("role", "listbox"); menu.setAttribute("aria-label", "输入命令")
  prompt.parentElement!.append(menu)
  let index = 0
  let entries: HTMLButtonElement[] = []
  const select = (next: number) => { index = next; entries.forEach((entry, i) => entry.setAttribute("aria-selected", String(i === index))) }
  const update = () => {
    const match = /^\/[a-z]*$/.test(prompt.value) && ready()
    const matches = match ? commands.filter(command => command.name.startsWith(prompt.value)) : []
    entries = matches.map(command => {
      const entry = document.createElement("button"); entry.type = "button"; entry.setAttribute("role", "option"); entry.textContent = `${command.name}  ${command.label}`
      entry.addEventListener("click", () => { menu.hidden = true; prompt.value = ""; prompt.dispatchEvent(new Event("input", { bubbles: true })); run({ type: command.action }) })
      return entry
    })
    menu.replaceChildren(...entries); menu.hidden = !entries.length; select(0)
  }
  prompt.addEventListener("input", update)
  prompt.addEventListener("keydown", event => {
    if (menu.hidden || event.isComposing) return
    if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation()
      if (event.key === "Escape") menu.hidden = true
      else if (event.key === "Enter") entries[index]?.click()
      else select((index + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length)
    }
  }, true)
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target as Node) && event.target !== prompt) menu.hidden = true })
}
