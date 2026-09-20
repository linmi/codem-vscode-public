import { createRoot } from "react-dom/client"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../webview/components/select.tsx"
import { previewScenarios } from "./previewScenarios.ts"

const url = new URL(location.href)
const scenario = url.searchParams.get("scenario") ?? "conversation"
const theme = url.searchParams.get("theme") === "dark" ? "dark" : "light"
const groups = [...new Set(previewScenarios.map(item => item[1]))]
function navigate(nextScenario: string, nextTheme: string) {
  const next = new URL(location.href)
  next.search = ""
  next.searchParams.set("scenario", nextScenario)
  next.searchParams.set("theme", nextTheme)
  location.href = next.href
}
function PreviewToolbar() {
  return <>
    <strong>CodeM · 模拟预览</strong>
    <div className="previewField"><span>场景</span>
      <Select value={scenario} onValueChange={value => navigate(value, theme)}>
        <SelectTrigger id="previewScenario" aria-label="预览场景" className="w-[240px]"><SelectValue /></SelectTrigger>
        <SelectContent position="popper" align="start" className="max-h-[360px]">
          {groups.map(group => <SelectGroup key={group}>
            <SelectLabel>{group}</SelectLabel>
            {previewScenarios.filter(item => item[1] === group).map(([id, , label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
          </SelectGroup>)}
        </SelectContent>
      </Select>
    </div>
    <div className="previewField"><span>主题</span>
      <Select value={theme} onValueChange={value => navigate(scenario, value)}>
        <SelectTrigger id="previewTheme" aria-label="预览主题"><SelectValue /></SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectItem value="light">浅色</SelectItem><SelectItem value="dark">深色</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <button id="resetPreview" type="button" onClick={() => navigate(scenario, theme)}>重置</button>
  </>
}
const container = document.getElementById("previewToolbar")
if (!container) throw new Error("Missing preview toolbar")
const root = createRoot(container)
root.render(<PreviewToolbar />)
window.addEventListener("pagehide", () => root.unmount(), { once: true })
