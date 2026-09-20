import { createRoot } from "react-dom/client"
import { FileCode2Icon, XIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import type { CodeSelectionView, ViewAction } from "../../src/shared/messages.ts"

export function createCodeSelection(host: HTMLElement, post: (action: ViewAction) => void) {
  const root = createRoot(host)
  return (selection: CodeSelectionView | null, disabled: boolean) => {
    host.hidden = selection === null
    root.render(selection && <>
      <span className="codeSelectionChip">
        <Button type="button" variant="ghost" className="codeSelectionSource" disabled={disabled} title={`${selection.path}:${selection.startLine}-${selection.endLine}`} aria-label={`定位选中代码 ${selection.label} ${selection.startLine}–${selection.endLine}`} onClick={() => post({ type: "revealCodeSelection", id: selection.id })}>
          <FileCode2Icon aria-hidden="true" /><span className="codeSelectionName">{selection.label}</span><span className="codeSelectionRange">{selection.startLine === selection.endLine ? selection.startLine : `${selection.startLine}–${selection.endLine}`}</span>
        </Button>
        <Button type="button" variant="ghost" size="icon" className="codeSelectionRemove" disabled={disabled} aria-label="移除选中代码" onClick={() => post({ type: "removeCodeSelection", id: selection.id })}><XIcon aria-hidden="true" /></Button>
      </span>
      {selection.error && <span className="codeSelectionError" role="status">{selection.error}</span>}
    </>)
  }
}
