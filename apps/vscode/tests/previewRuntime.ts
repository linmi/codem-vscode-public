import type { ChatSnapshot, ViewAction } from "../src/messages.ts"
import type { PanelReply, PanelView } from "../src/panelTypes.ts"
import { createPreviewState, type PreviewSearch } from "./previewState.ts"

export function createPreviewRuntime(initial: PreviewSearch) {
  let search = initial
  let { demo, panels, activePanel } = createPreviewState(initial)
  let ready = false
  let generation = 0
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const panelReplies: PanelReply[] = []
  const viewActions: ViewAction[] = []
  function emit(data: unknown) {
    window.dispatchEvent(new MessageEvent("message", { data: structuredClone(data) }))
  }
  function publish() {
    if (!ready) return
    emit(demo)
    emit({ type: "panel", panel: activePanel })
  }
  function reset() {
    clearTimeout(refreshTimer)
    generation++
    const next = createPreviewState(search)
    demo = next.demo; panels = next.panels; activePanel = next.activePanel
    // New fixture identity clears previous disclosure/input state without a blank frame.
    demo.threadId = demo.threadId ? `preview${generation}` : null
    demo.messages = demo.messages.map(message => ({ ...message, id: `${generation}:${message.id}` }))
    if (activePanel) activePanel.id = `preview${generation}Panel`
    panelReplies.length = 0; viewActions.length = 0
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")
    if (prompt) { prompt.value = ""; prompt.dispatchEvent(new Event("input", { bubbles: true })) }
    publish()
  }
  function select(next: PreviewSearch) {
    const changed = next.scenario !== search.scenario || next.panel !== search.panel || next.empty !== search.empty
    search = next
    document.body.classList.toggle("vscode-dark", next.theme === "dark")
    document.body.classList.toggle("vscode-light", next.theme === "light")
    if (changed) reset()
  }
  function postMessage(action: ViewAction) {
    viewActions.push(action)
    if (action.type === "ready") { ready = true; publish(); return }
    if (action.type === "searchFiles") { emit({type:"fileSearchResult",requestId:action.requestId,files:action.query==="missing"?[]:[{id:"fileFixture",label:"src/main.ts"}],error:null}); return }
    if (action.type === "selectFile") { demo.attachments=[{id:"fileFixture",label:"src/main.ts",kind:"file",preview:{kind:"none"}}]; publish(); emit({type:"fileSelected",requestId:action.requestId,accepted:true}); return }
    const picker: Partial<Record<ViewAction["type"], string>> = { selectPermission: "permissionMode", selectWorkMode:"workMode", selectSpace:"space", selectEffort:"effort", selectModel:"model" }
    const name = picker[action.type]
    if (name) {
      activePanel = structuredClone(panels[name]!)
      if (activePanel.kind === "permissionMode") activePanel.choices.forEach(choice => { choice.selected = choice.id === demo.permission })
    }
    if (action.type === "panelReply") {
      panelReplies.push(action)
      const choice = !action.cancelled ? activePanel?.choices.find(item => item.id === action.choiceIds[0]) : undefined
      if (choice && activePanel) applyChoice(demo, activePanel, choice.id, choice.label)
      if (!action.cancelled && activePanel?.kind === "space" && choice?.id === "refresh") {
        const owner = generation
        activePanel = {...panels.space!, id:"spaceRefreshing", description:"正在刷新空间列表…", choices:[]}
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
          if (owner === generation && activePanel?.id === "spaceRefreshing") {
            activePanel = {...panels.space!, id:"spaceRefreshed"}
            publish()
          }
        }, 500)
      } else activePanel = null
    }
    if (action.type === "showHistory") demo.history = {...demo.history, open:true, entries:[{id:"preview",title:"整理登录页面",startedAt:"2026-09-19T12:00:00Z",turnCount:1,archived:false}]}
    if (action.type === "closeHistory") demo.history.open = false
    demo.phase = activePanel ? (["space","model","effort","permissionMode","workMode"].includes(activePanel.kind) ? "configuring" : "running") : "ready"
    publish()
  }
  // Browser fixtures expose inspection handles only; none are shipped to the extension.
  Object.defineProperties(window, {
    demo: { configurable: true, get: () => demo },
    panels: { configurable: true, get: () => panels },
    panelReplies: { configurable: true, get: () => panelReplies },
    viewActions: { configurable: true, get: () => viewActions },
  })
  Object.assign(window, { acquireVsCodeApi: () => ({ getState: () => null, setState: () => {}, postMessage }) })
  return { select, reset, dispose: () => clearTimeout(refreshTimer) }
}

function applyChoice(demo: ChatSnapshot, panel: PanelView, id: string, label: string) {
  if (panel.kind === "permissionMode" && (id === "default" || id === "auto" || id === "yolo")) demo.permission = id
  if (panel.kind === "workMode" && (id === "default" || id === "plan")) demo.workMode = id
  if (panel.kind === "effort") demo.effort = id
  if (panel.kind === "space" && id !== "refresh") demo.space = label
  if (panel.kind === "model") demo.model = label
}
