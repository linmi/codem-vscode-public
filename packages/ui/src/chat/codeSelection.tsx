import { FileCode2Icon, PlusIcon, XIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import type { SelectionView } from "../contract.ts"

const maxPinned = 20

/** 对照 VS Code codeSelection：当前选区可固定，固定项随消息发送。 */
export function CodeSelectionList({
  items,
  disabled,
  post,
}: {
  items: readonly SelectionView[]
  disabled: boolean
  post: (action: Record<string, unknown>) => void
}) {
  if (!items.length) return null
  const pinnedCount = items.filter((item) => item.pinned !== false).length
  return (
    <>
      {items.map((selection) => {
        const pinned = selection.pinned !== false
        const range = selection.startLine && selection.endLine
          ? (selection.startLine === selection.endLine ? String(selection.startLine) : `${selection.startLine}–${selection.endLine}`)
          : ""
        return (
          <div className="codeSelectionItem" key={selection.id}>
            <span className="codeSelectionChip" data-pinned={pinned}>
              <Button type="button" variant="ghost" className="codeSelectionSource" disabled={disabled} aria-label={`定位选中代码 ${selection.label} ${range}`} title={pinned ? "已固定，发送选中时的代码" : "当前选区，跟随划选"} onClick={() => post({ type: "revealCodeSelection", id: selection.id })}>
                <FileCode2Icon aria-hidden="true" />
                <span className="codeSelectionName">{selection.label}</span>
                {range ? <span className="codeSelectionRange">{range}</span> : null}
              </Button>
              {!pinned ? (
                <Button type="button" variant="ghost" size="icon" className="codeSelectionPin" disabled={disabled || Boolean(selection.error) || pinnedCount >= maxPinned} title="固定到本次提问，切换文件后保留" aria-label={`固定选中代码 ${selection.label} ${range}`} onClick={() => post({ type: "pinCodeSelection", id: selection.id })}>
                  <PlusIcon aria-hidden="true" />
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon" className="codeSelectionRemove" disabled={disabled} aria-label={`移除${pinned ? "固定" : "选中"}代码 ${selection.label} ${range}`} onClick={() => post({ type: "removeCodeSelection", id: selection.id })}>
                <XIcon aria-hidden="true" />
              </Button>
            </span>
            {selection.error ? <span className="codeSelectionError" role="status">{selection.error}</span> : null}
          </div>
        )
      })}
    </>
  )
}
