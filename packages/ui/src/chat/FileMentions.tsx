import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react"
import { Command, CommandItem, CommandList } from "../components/ui/command.tsx"
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover.tsx"
import type { FileSearch } from "../contract.ts"
import { activeMention, mentionQuery, mentionResults, nextMentionSession, stepMention, type MentionSession } from "./composerInput.ts"
import { nextRequestId } from "./requestIds.ts"

/** 打开的提及菜单要的全部内容；菜单收起时为 null。 */
interface MentionMenu {
  search: FileSearch
  active: string | null
  highlight: (id: string) => void
  choose: (id: string) => void
  close: () => void
  listRef: (node: HTMLDivElement | null) => void
  activeRef: (node: HTMLDivElement | null) => void
}

/**
 * `@` 提及的状态都在这里：本次提及的请求、高亮项，以及输入框指向列表所需的 id。
 * 光标前出现 `@query` 后防抖 150ms 请求 Host 搜索；结果只显示相对路径，选中后由 Host 换成附件句柄。
 * 焦点始终留在输入框：方向键移动高亮，Enter / Tab 选中，Esc 或点在菜单外收起，直到下一次输入。
 * 草稿变化、切到其他输入模式或进入忙碌阶段时重新判断；Host 清掉搜索结果（切换工作区、空间或会话）时菜单随之收起。
 */
export function useFileMentions({
  draft,
  enabled,
  prompt,
  fileSearch,
  post,
  saveDraft,
}: {
  draft: string
  /** 普通消息且不忙碌时才接受提及。 */
  enabled: boolean
  prompt: RefObject<HTMLTextAreaElement | null>
  fileSearch: FileSearch | null
  post: (action: Record<string, unknown>) => void
  saveDraft: (text: string) => void
}) {
  const [session, setSession] = useState<MentionSession | null>(null)
  const [highlight, setHighlight] = useState<{ requestId: string; id: string } | null>(null)
  const [listId, setListId] = useState<string | null>(null)
  const [optionId, setOptionId] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const caret = prompt.current?.selectionStart ?? draft.length
    const mention = enabled ? mentionQuery(draft, caret) : null
    if (!mention) {
      setSession(null)
      return
    }
    const request = nextRequestId("mention")
    const arrived = fileSearch?.requestId
    setSession((current) => nextMentionSession(current, request, arrived))
    timer.current = window.setTimeout(() => post({ type: "searchFiles", query: mention.query, requestId: request }), 150)
    return () => window.clearTimeout(timer.current)
  }, [draft, enabled])

  const search = enabled ? mentionResults(fileSearch, session) : null
  const active = activeMention(search, highlight)

  // cmdk 自己生成列表和选项的 id；挂上时记下，输入框用它们指向当前高亮项。
  const listRef = useCallback((node: HTMLDivElement | null) => setListId(node?.id ?? null), [])
  const activeRef = useCallback((node: HTMLDivElement | null) => {
    setOptionId(node?.id ?? null)
    node?.scrollIntoView({ block: "nearest" })
  }, [])

  const close = () => {
    window.clearTimeout(timer.current)
    setSession(null)
  }

  const choose = (id: string) => {
    const caret = prompt.current?.selectionStart ?? draft.length
    const mention = mentionQuery(draft, caret)
    close()
    if (mention) saveDraft(`${draft.slice(0, mention.start)}${draft.slice(caret)}`)
    post({ type: "selectFile", id, requestId: nextRequestId("pick") })
  }

  /** 菜单有结果时处理方向键、Enter 和 Tab，返回 true 表示已处理；Esc 由菜单浮层处理。 */
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!search || !active || event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const next = stepMention(search.files, active, event.key === "ArrowDown" ? 1 : -1)
      if (next) setHighlight({ requestId: search.requestId, id: next })
    } else if (event.key === "Enter" || event.key === "Tab") {
      choose(active)
    } else {
      return false
    }
    event.preventDefault()
    return true
  }

  const menu: MentionMenu | null = search
    ? {
        search,
        active,
        highlight: (id) => setHighlight({ requestId: search.requestId, id }),
        choose,
        close,
        listRef,
        activeRef,
      }
    : null

  return {
    keyDown,
    /** 输入框一直声明会弹出候选列表；有高亮项时指向列表和该项，读屏随方向键播报。 */
    inputProps: {
      "aria-autocomplete": "list" as const,
      "aria-controls": active && listId ? listId : undefined,
      "aria-activedescendant": active && optionId ? optionId : undefined,
    },
    menu,
  }
}

/**
 * `@` 提及菜单：Popover + Command，照原位置浮在整个输入栏上方（两侧各收 12px），不挡住附件。
 * 焦点和键盘都在输入框里，输入框通过 aria-activedescendant 指向这里的高亮项。
 * 结果由 Host 搜索，不再本地过滤；高亮项由 useFileMentions 持有，指针悬停同样改它。
 */
export function FileMentions({ menu, anchor }: { menu: MentionMenu; anchor: RefObject<HTMLElement | null> }) {
  const { search, active } = menu
  const status = search.status === "loading" ? "正在搜索工作区文件…" : search.files.length ? null : search.error
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) menu.close()
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        className="fileMentions"
        data-testid="fileMentions"
        aria-label="引用工作区文件"
        side="top"
        align="start"
        sideOffset={6}
        alignOffset={12}
        collisionPadding={12}
        // 焦点留在输入框：打开不抢焦点，点选不移走焦点，收起也不挪焦点。
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Command
          shouldFilter={false}
          value={active ?? ""}
          onValueChange={(value) => {
            if (value) menu.highlight(value)
          }}
        >
          {status ? (
            <p className="fileSearchStatus" role="status">
              {status}
            </p>
          ) : null}
          <CommandList ref={menu.listRef} label="工作区文件" hidden={search.files.length === 0}>
            {search.files.map((file) => (
              <CommandItem key={file.id} ref={file.id === active ? menu.activeRef : undefined} value={file.id} onSelect={() => menu.choose(file.id)}>
                {file.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
