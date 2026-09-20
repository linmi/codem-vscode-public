import { useState } from "react"
import { createRoot } from "react-dom/client"
import type { PanelView, PanelReply } from "../../src/panelTypes.ts"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog.tsx"
import { Button } from "./button.tsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.tsx"

function RewindPanel({ panel, post }: { panel: PanelView; post: (reply: PanelReply) => void }) {
  const [id, setId] = useState("")
  const [pending, setPending] = useState(false)
  const answer = (cancelled: boolean) => {
    if (pending || (!cancelled && !panel.choices.some(choice => choice.id === id))) return
    setPending(true)
    post({ type: "panelReply", id: panel.id, choiceIds: cancelled ? [] : [id], text: "", cancelled })
  }
  return <Dialog open onOpenChange={open => { if (!open) answer(true) }}><DialogContent className="rewindDialog"><DialogTitle>{panel.title}</DialogTitle><DialogDescription>{panel.description}</DialogDescription><Select value={id} onValueChange={setId} disabled={pending}><SelectTrigger aria-label="回退选项"><SelectValue placeholder="请选择" /></SelectTrigger><SelectContent>{panel.choices.map(choice => <SelectItem value={choice.id} key={choice.id}>{choice.label}</SelectItem>)}</SelectContent></Select><p>{panel.choices.find(choice => choice.id === id)?.description}</p><div className="sessionToolActions rewindActions"><Button variant="outline" disabled={pending} onClick={() => answer(true)}>取消回退</Button><Button variant="destructive" disabled={pending || !id} onClick={() => answer(false)}>{panel.confirmLabel ?? "继续"}</Button></div></DialogContent></Dialog>
}
export function createRewindPanel(host: HTMLElement, post: (reply: PanelReply) => void) {
  const root = createRoot(host)
  return (panel: PanelView | null) => root.render(panel ? <RewindPanel key={panel.id} panel={panel} post={post} /> : null)
}
