import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { CODEM_BUILTIN_INTELLIGENCE_TIERS, CODEM_DEFAULT_INTELLIGENCE, parseCodemIntelligence } from "@codem/protocol"
import { initialSnapshot, isBusy, type ChatSnapshot, type ViewAction } from "../../src/shared/messages.ts"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger } from "../components/ui/select.tsx"
import { ComposerMenuHeading } from "./composerMenuHeading.tsx"

function EffortSelector({ state, post }: { state: ChatSnapshot; post: (action: ViewAction) => void }) {
  const [open, setOpen] = useState(false)
  const enabled = !isBusy(state.phase) && !state.backgroundBusy && !state.sessionTools.busy
  useEffect(() => { if (!enabled) setOpen(false) }, [enabled])
  const level = CODEM_BUILTIN_INTELLIGENCE_TIERS.indexOf(state.effort)
  return <Select value={state.effort} open={enabled && open} onOpenChange={setOpen} disabled={!enabled} onValueChange={value => post({ type: "setEffort", effort: parseCodemIntelligence(value) })}>
    <SelectTrigger id="selectEffort" className="effortTrigger" aria-label={`思考强度：${state.effort}`} title={`思考强度：${state.effort}`} aria-busy={state.phase === "configuring"}>
      <span><svg className="effortSignal" data-effort={state.effort} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        {CODEM_BUILTIN_INTELLIGENCE_TIERS.map((tier, index) => <path key={tier} data-active={index <= level} opacity={index <= level ? 1 : 0.2} d={`M${5 + index * 5} 19V${16 - index * 4}`} />)}
      </svg></span>
    </SelectTrigger>
    <SelectContent className="composerPickerMenu effortMenu" position="popper" side="top" align="end" sideOffset={8} collisionPadding={12}>
      <SelectGroup><ComposerMenuHeading close={() => setOpen(false)}><SelectLabel>思考强度</SelectLabel></ComposerMenuHeading>
        {CODEM_BUILTIN_INTELLIGENCE_TIERS.map(tier => <SelectItem key={tier} value={tier} textValue={tier}>{tier}{tier === CODEM_DEFAULT_INTELLIGENCE && <span className="effortDefault">默认</span>}</SelectItem>)}
      </SelectGroup>
    </SelectContent>
  </Select>
}

export function createEffortSelector(host: HTMLElement, post: (action: ViewAction) => void) {
  const root = createRoot(host)
  const render = (state: ChatSnapshot) => root.render(<EffortSelector key={`${state.workspace}:${state.space}:${state.threadId}`} state={state} post={post} />)
  render(initialSnapshot())
  return render
}
