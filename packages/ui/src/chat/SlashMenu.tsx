import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command.tsx"
import type { ChatSnapshot } from "../contract.ts"
import { commandUnavailable, slashCatalog, slashGroups } from "./slashCommands.ts"

/**
 * 对照 VS Code slashMenu：打开只过滤本地目录，不请求 Host / Core。
 */
export function SlashMenu({
  snapshot,
  query,
  onClose,
  onChoose,
}: {
  snapshot: ChatSnapshot
  query: string
  onClose: (focus: boolean) => void
  onChoose: (id: string) => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(query)
  const [position, setPosition] = useState({ bottom: 88, width: 480 })
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose(false)
    }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [onClose])
  useLayoutEffect(() => {
    const composer = document.getElementById("prompt")
    const measure = () => {
      const rect = composer?.getBoundingClientRect()
      setPosition({
        bottom: rect ? Math.max(24, window.innerHeight - rect.top + 8) : 88,
        width: rect ? Math.min(480, rect.width) : 480,
      })
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])
  const commands = slashCatalog(snapshot)
  return (
    <div ref={menu} className="slashMenu" data-testid="slashMenu" style={{ bottom: position.bottom, width: position.width, left: 16 }}>
      <Command
        label="搜索会话命令"
        loop
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            onClose(true)
          }
        }}
      >
        <CommandInput autoFocus aria-label="搜索会话命令" placeholder="搜索命令或操作…" value={value} onValueChange={setValue} />
        <CommandList label="会话命令列表">
          <CommandEmpty>没有匹配的命令，按 Esc 返回修改。</CommandEmpty>
          {slashGroups.map((group) => {
            const items = commands.filter((command) => command.group === group)
            if (!items.length) return null
            return (
              <CommandGroup key={group} heading={group}>
                {items.map((command) => {
                  const reason = commandUnavailable(command.id, snapshot)
                  return (
                    <CommandItem
                      key={command.id}
                      value={command.id}
                      keywords={[command.label]}
                      disabled={Boolean(reason)}
                      data-testid={`slash-${command.id}`}
                      onSelect={() => {
                        if (reason) return
                        onChoose(command.id)
                      }}
                    >
                      <span className="slashName">/{command.id}</span>
                      <span className="slashLabel">
                        {command.label}
                        {reason ? <small>{reason}</small> : null}
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })}
        </CommandList>
        <div className="slashFooter">↑ ↓ 选择 · Enter 确认 · Esc 返回</div>
      </Command>
    </div>
  )
}
