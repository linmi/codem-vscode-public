import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { createPortal } from "react-dom"
import { SlashIcon } from "lucide-react"
import type { ChatSnapshot } from "../../src/messages.ts"
import { commandUnavailable, sessionCommands, type SessionCommandId } from "../../src/sessionCommands.ts"
import { Button } from "./button.tsx"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command.tsx"
interface Request { id: number; query: string }
interface Props { state: ChatSnapshot; request: Request | null; open: () => void; close: (focus: boolean) => void; choose: (id: SessionCommandId) => void; composer: HTMLElement }
function SlashCommands({ state, request, open, close, choose, composer }: Props) {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!request) return
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !(event.target as Element).closest?.('#openCommands')) close(false) }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [request, close])
  return <><Button id="openCommands" data-thread-id={state.threadId ?? ""} type="button" className="toolPanelTrigger" variant="ghost" size="icon" title="会话命令 /" aria-label="会话命令" aria-expanded={Boolean(request)} onClick={() => request ? close(true) : open()}><SlashIcon aria-hidden="true" /></Button>
    {request && createPortal(<CommandMenu key={request.id} {...{ state, request, close, choose, menu, composer }} />, composer)}
  </>
}
function CommandMenu({ state, request, close, choose, menu, composer }: Pick<Props, "state" | "close" | "choose" | "composer"> & { request: Request; menu: React.RefObject<HTMLDivElement | null> }) {
  const [query, setQuery] = useState(request.query)
  const measurePosition = () => {
    const rect = composer.getBoundingClientRect()
    const top = (document.querySelector("main")?.getBoundingClientRect().top ?? 0) + 8
    // In short windows, overlay the composer instead of hiding the search field above the viewport.
    const anchor = rect.top - top >= 188 ? rect.top - 8 : window.innerHeight - 24
    return { bottom: window.innerHeight - anchor, left: rect.left, width: rect.width, available: anchor - top }
  }
  const [position, setPosition] = useState(measurePosition)
  useLayoutEffect(() => {
    const measure = () => setPosition(measurePosition)
    const observer = new ResizeObserver(measure)
    observer.observe(composer); window.addEventListener("resize", measure); measure()
    return () => { observer.disconnect(); window.removeEventListener("resize", measure) }
  }, [composer])
  return <div className="slashMenu" ref={menu} style={{ bottom: position.bottom, left: position.left, width: Math.min(480, position.width) }}>
    <Command label="搜索会话命令" loop onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true) } }}>
      <CommandInput autoFocus aria-label="搜索会话命令" placeholder="搜索命令或操作…" value={query} onValueChange={setQuery} />
      <CommandList label="会话命令列表" style={{ maxHeight: Math.min(340, Math.max(40, position.available - 76)) }}><CommandEmpty>没有匹配的命令，按 Esc 返回修改。</CommandEmpty>
        {["常用", "输入", "会话", "能力"].map(group => <CommandGroup key={group} heading={group}>{sessionCommands.filter(command => command.group === group).map(command => {
          const reason = commandUnavailable(command.id, state)
          return <CommandItem key={command.id} value={command.id} keywords={[command.label]} disabled={Boolean(reason)} onSelect={() => choose(command.id)}><span className="slashName">/{command.id}</span><span className="slashLabel">{command.label}{reason && <small>{reason}</small>}</span></CommandItem>
        })}</CommandGroup>)}
      </CommandList>
      <div className="slashFooter">↑ ↓ 选择 · Enter 确认 · Esc 返回</div>
    </Command>
  </div>
}
export function createSlashCommands(host: HTMLElement, composer: HTMLElement, prompt: HTMLTextAreaElement, chooseCommand: (id: SessionCommandId) => void) {
  const root = createRoot(host)
  let state: ChatSnapshot
  let request: Request | null = null
  let sequence = 0
  let scope = ""
  const render = () => root.render(<SlashCommands state={state} request={request} composer={composer} open={() => open("")} close={close} choose={choose} />)
  function close(focus: boolean) { request = null; render(); if (focus) prompt.focus() }
  function open(query: string) { request = { id: ++sequence, query }; render() }
  function choose(id: SessionCommandId) {
    if (commandUnavailable(id, state)) return
    close(true); chooseCommand(id)
  }
  return { open, close, update(next: ChatSnapshot) {
    const nextScope = JSON.stringify([next.workspace, next.space, next.threadId])
    if (scope !== nextScope) request = null
    scope = nextScope; state = next; render()
  } }
}
