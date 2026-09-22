import { useState } from "react"
import { Button } from "../components/ui/button.tsx"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog.tsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx"
import type { PendingPanel } from "../contract.ts"

/** 对照 VS Code rewindPanel。取消关闭对话框并回复 cancelled。 */
export function RewindPanel({ panel, post }: { panel: PendingPanel | null; post: (action: Record<string, unknown>) => void }) {
  const [id, setId] = useState("")
  const [pending, setPending] = useState(false)
  if (!panel || panel.kind !== "rewind") return null
  const answer = (cancelled: boolean) => {
    if (pending || (!cancelled && !panel.choices.some((choice) => choice.id === id))) return
    setPending(true)
    post({ type: "panelReply", id: panel.id, choiceIds: cancelled ? [] : [id], text: "", cancelled })
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) answer(true) }}>
      <DialogContent className="rewindDialog">
        <DialogTitle>{panel.title}</DialogTitle>
        <DialogDescription>{panel.description}</DialogDescription>
        <Select value={id} onValueChange={setId} disabled={pending}>
          <SelectTrigger aria-label="回退选项"><SelectValue placeholder="请选择" /></SelectTrigger>
          <SelectContent>{panel.choices.map((choice) => <SelectItem value={choice.id} key={choice.id}>{choice.label}</SelectItem>)}</SelectContent>
        </Select>
        <p>{panel.choices.find((choice) => choice.id === id)?.description}</p>
        <div className="sessionToolActions rewindActions">
          <Button variant="outline" disabled={pending} onClick={() => answer(true)}>取消回退</Button>
          <Button variant="destructive" disabled={pending || !id} onClick={() => answer(false)}>{panel.confirmLabel ?? "继续"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
