import { useRef, useState, type RefObject } from "react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command.tsx"
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover.tsx"
import type { ChatSnapshot } from "../contract.ts"
import { commandUnavailable, slashCatalog, slashGroups } from "./slashCommands.ts"

/**
 * 对照 VS Code slashMenu：打开只过滤本地目录，不请求 Host / Core。
 * 浮层贴在输入框上沿，由 Popover 定位；点在浮层外收起且不抢焦点，Esc 收起并把焦点还给输入框。
 */
export function SlashMenu({
  snapshot,
  query,
  anchor,
  onClose,
  onChoose,
}: {
  snapshot: ChatSnapshot
  query: string
  /** 输入框：菜单与它左对齐，宽度不超过它。 */
  anchor: RefObject<HTMLTextAreaElement | null>
  onClose: (focus: boolean) => void
  onChoose: (id: string) => void
}) {
  const search = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(query)
  const commands = slashCatalog(snapshot)
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose(false)
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        className="slashMenu"
        data-testid="slashMenu"
        aria-label="会话命令"
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          search.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          onClose(true)
        }}
        // 选中命令后焦点交给它打开的界面（模型菜单、命令对话框），这里不再把焦点拉回别处。
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Command label="搜索会话命令" loop>
          <CommandInput ref={search} aria-label="搜索会话命令" placeholder="搜索命令或操作…" value={value} onValueChange={setValue} />
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
      </PopoverContent>
    </Popover>
  )
}
