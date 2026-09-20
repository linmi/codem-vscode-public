import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { MenuIcon } from "lucide-react"
import { Button } from "../webview/components/button.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../webview/components/collapsible.tsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../webview/components/select.tsx"
import { previewScenarios } from "./previewScenarios.ts"

const url = new URL(location.href)
const scenario = url.searchParams.get("scenario") ?? "conversation"
const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light"
const groups = [...new Set(previewScenarios.map(item => item[1]))]
function scenarioUrl(nextScenario: string, nextTheme: string): string {
  const next = new URL(location.href)
  next.search = ""
  next.searchParams.set("scenario", nextScenario)
  next.searchParams.set("theme", nextTheme)
  return next.href
}
function PreviewNavigation() {
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 700px)").matches)
  const [expanded, setExpanded] = useState(false)
  const toc = useRef<HTMLElement>(null)
  useEffect(() => {
    toc.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest" })
  }, [narrow, expanded])
  useEffect(() => {
    const media = matchMedia("(max-width: 700px)")
    const resize = () => { setNarrow(media.matches); setExpanded(false) }
    media.addEventListener("change", resize)
    return () => media.removeEventListener("change", resize)
  }, [])
  return <Collapsible className="previewSidebar" open={!narrow || expanded} onOpenChange={setExpanded}>
    <div className="previewHeading">
      <strong>CodeM · 模拟预览</strong>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="previewTocToggle" aria-label="场景目录"><MenuIcon /></Button>
      </CollapsibleTrigger>
    </div>
    <CollapsibleContent className="previewSidebarContent">
      <div className="previewControls">
        <Select value={theme} onValueChange={value => { location.href = scenarioUrl(scenario, value) }}>
          <SelectTrigger id="previewTheme" aria-label="预览主题"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectItem value="light">浅色</SelectItem><SelectItem value="dark">深色</SelectItem>
          </SelectContent>
        </Select>
        <Button id="resetPreview" variant="ghost" size="sm" onClick={() => { location.href = scenarioUrl(scenario, theme) }}>重置</Button>
      </div>
      <nav ref={toc} className="previewToc" aria-label="场景目录">
        {groups.map(group => <section key={group} aria-label={group}>
          <h2>{group}</h2>
          {previewScenarios.filter(item => item[1] === group).map(([id, , label]) =>
            <Button key={id} asChild variant="ghost" size="sm" className="previewScenarioLink">
              <a href={scenarioUrl(id, theme)} aria-current={id === scenario ? "page" : undefined}>{label}</a>
            </Button>
          )}
        </section>)}
      </nav>
    </CollapsibleContent>
  </Collapsible>
}
const container = document.getElementById("previewNavigation")
if (!container) throw new Error("Missing preview navigation")
const root = createRoot(container)
root.render(<PreviewNavigation />)
window.addEventListener("pagehide", () => root.unmount(), { once: true })
