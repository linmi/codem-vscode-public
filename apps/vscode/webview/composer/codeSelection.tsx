import { MAX_PINNED_CODE_SELECTIONS } from "../../src/shared/editorContext.ts"
import { createRoot } from "react-dom/client"
import { FileCode2Icon, PlusIcon, XIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import type { CodeSelectionView, CodeSelectionsView, ViewAction } from "../../src/shared/messages.ts"

function SelectionChip({ selection, pinned, disabled, canPin, post }: { selection: CodeSelectionView; pinned: boolean; disabled: boolean; canPin: boolean; post: (action: ViewAction) => void }) {
  const range = selection.startLine === selection.endLine ? String(selection.startLine) : `${selection.startLine}–${selection.endLine}`
  return <div className="codeSelectionItem">
    <span className="codeSelectionChip" data-pinned={pinned}>
      <Button type="button" variant="ghost" className="codeSelectionSource" disabled={disabled} title={`${selection.path}:${range}${pinned ? "（已固定，发送选中时的代码）" : "（当前选区，跟随划选）"}`} aria-label={`定位选中代码 ${selection.label} ${range}`} onClick={() => post({ type: "revealCodeSelection", id: selection.id })}>
        <FileCode2Icon aria-hidden="true" /><span className="codeSelectionName">{selection.label}</span><span className="codeSelectionRange">{range}</span>
      </Button>
      {!pinned && <Button type="button" variant="ghost" size="icon" className="codeSelectionPin" disabled={disabled || Boolean(selection.error) || !canPin} title="固定到本次提问，切换文件后保留" aria-label={`固定选中代码 ${selection.label} ${range}`} onClick={() => post({ type: "pinCodeSelection", id: selection.id })}><PlusIcon aria-hidden="true" /></Button>}
      <Button type="button" variant="ghost" size="icon" className="codeSelectionRemove" disabled={disabled} aria-label={`移除${pinned ? "固定" : "选中"}代码 ${selection.label} ${range}`} onClick={() => post({ type: "removeCodeSelection", id: selection.id })}><XIcon aria-hidden="true" /></Button>
    </span>
    {selection.error && <span className="codeSelectionError" role="status">{selection.error}</span>}
  </div>
}

export function createCodeSelection(host: HTMLElement, post: (action: ViewAction) => void) {
  const root = createRoot(host)
  return (selections: CodeSelectionsView, disabled: boolean) => {
    host.hidden = selections.current === null && selections.pinned.length === 0
    root.render(<>
      {selections.pinned.map(selection => <SelectionChip key={selection.id} selection={selection} pinned disabled={disabled} canPin={false} post={post} />)}
      {selections.current && <SelectionChip key={selections.current.id} selection={selections.current} pinned={false} disabled={disabled} canPin={selections.pinned.length < MAX_PINNED_CODE_SELECTIONS} post={post} />}
    </>)
  }
}
