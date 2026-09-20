import { createRootRoute, createRoute, createRouter, Link, RouterProvider } from "@tanstack/react-router"
import { createPreviewRuntime } from "./previewRuntime.ts"
import { parsePreviewSearch } from "./previewState.ts"
import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { MenuIcon } from "lucide-react"
import { Button } from "../webview/components/ui/button.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../webview/components/ui/collapsible.tsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../webview/components/ui/select.tsx"
import { previewScenarios } from "./previewScenarios.ts"

const runtime = createPreviewRuntime(parsePreviewSearch(Object.fromEntries(new URL(location.href).searchParams)))
const rootRoute = createRootRoute()
const previewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", validateSearch: parsePreviewSearch, component: PreviewNavigation })
const router = createRouter({ routeTree: rootRoute.addChildren([previewRoute]), defaultPreload: false, scrollRestoration: false })
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
const unsubscribe = router.subscribe("onResolved", event => runtime.select(parsePreviewSearch(event.toLocation.search)))
const groups = [...new Set(previewScenarios.map(item => item[1]))]
function PreviewNavigation() {
  const { scenario, theme } = previewRoute.useSearch()
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
        <Select value={theme} onValueChange={value => { void router.navigate({ to: "/", search: { scenario, theme: value === "dark" ? "dark" : "light" }, resetScroll: false }) }}>
          <SelectTrigger id="previewTheme" aria-label="预览主题"><SelectValue /></SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectItem value="light">浅色</SelectItem><SelectItem value="dark">深色</SelectItem>
          </SelectContent>
        </Select>
        <Button id="resetPreview" variant="ghost" size="sm" onClick={() => { runtime.reset() }}>重置</Button>
      </div>
      <nav ref={toc} className="previewToc" aria-label="场景目录">
        {groups.map(group => <section key={group} aria-label={group}>
          <h2>{group}</h2>
          {previewScenarios.filter(item => item[1] === group).map(([id, , label]) =>
            <Button key={id} asChild variant="ghost" size="sm" className="previewScenarioLink">
              <Link to="/" search={{ scenario: id, theme }} resetScroll={false} activeOptions={{ exact: true, includeSearch: true }} onClick={() => { if (narrow) setExpanded(false) }} aria-current={id === scenario ? "page" : undefined}>{label}</Link>
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
root.render(<RouterProvider router={router} />)
window.addEventListener("pagehide", () => { unsubscribe(); runtime.dispose(); root.unmount() }, { once: true })
