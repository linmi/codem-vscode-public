import { attachmentScope, parsePastedImages } from "../src/shared/pastedImages.ts"
import { appendContext, codePrompt } from "../src/shared/editorContext.ts"
import type { ChatSnapshot, CodeSelectionsView, ViewAction } from "../src/shared/messages.ts"
import type { AccountState } from "../src/shared/accountTypes.ts"
import type { PanelReply } from "../src/shared/panelTypes.ts"
import { createPreviewState, type PreviewSearch } from "./previewState.ts"
import { applyPreviewCatalog, previewImage, contentScenario } from "./previewContent.ts"
import { catalogKinds } from "../src/shared/capabilityTypes.ts"

export function createPreviewRuntime(initial: PreviewSearch) {
  let search = initial
  let { demo, panels, activePanel, surface } = createPreviewState(initial)
  const selectionFixture = (): CodeSelectionsView => ({ current: ["codeSelection", "codeSelectionFailure"].includes(search.scenario) ? { id: "selected-code", label: "connectionPreferences.ts", path: "src/connection/connectionPreferences.ts", startLine: 10, endLine: 15, error: null } : null, pinned: [] })
  let selectedCode = selectionFixture()
  const signedIn = (): AccountState => ({ status: "signedIn", profile: { avatar: search.scenario === "accountAvatar" ? {kind:"image",url:"/logo.svg"} : search.scenario === "accountAvatarFailure" ? {kind:"image",url:"/missing-avatar.jpg"} : {kind:"none"}, displayName: "林晓", userId: "preview-user", tenantId: "preview-team", authMethod: "browser" }, refreshing: false, notice: null })
  const accountFixture = (): AccountState => search.scenario === "accountSignedOut" ? { status: "signedOut", notice: null } : search.scenario === "accountSigningIn" ? { status: "signingIn", progress: "waiting" } : search.scenario === "accountFailure" ? { status: "error", message: "登录未完成，请重试。" } : signedIn()
  let account = accountFixture()
  let logoutAttempts = 0
  let loginTimer: ReturnType<typeof setTimeout> | undefined
  let ready = false
  let generation = 0
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let delayedSubmission: string | null = null
  let permissionReturnPhase: ChatSnapshot["phase"] | null = null
  const frames = new Set<number>()
  const imageAttempts = new Map<string, number>()
  const pendingElements = new Set<() => void>()
  const panelReplies: PanelReply[] = []
  const viewActions: ViewAction[] = []
  function emit(data: unknown) {
    window.dispatchEvent(new MessageEvent("message", { data: structuredClone(data) }))
  }
  function publish() {
    if (!ready || search.scenario === "waitingForHost") return
    emit({ type: "account", state: account })
    emit(demo)
    emit({ type: "codeSelection", value: selectedCode })
    emit({ type: "panel", panel: activePanel })
  }
  function nextFrame(callback: () => void) {
    const owner = generation
    const id = requestAnimationFrame(() => { frames.delete(id); if (owner === generation) callback() })
    frames.add(id)
  }
  function whenRendered(selector: string, callback: (node: HTMLElement) => void) {
    const owner = generation
    const finish = () => { observer.disconnect(); clearTimeout(timer); pendingElements.delete(finish) }
    const check = () => {
      if (owner !== generation) { finish(); return }
      const node = document.querySelector<HTMLElement>(selector)
      if (node) { finish(); callback(node) }
    }
    const observer = new MutationObserver(check)
    const timer = setTimeout(() => { finish(); throw new Error(`Preview surface did not mount: ${selector}`) }, 3000)
    pendingElements.add(finish)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    check()
  }
  function showSurface() {
    // React and the transcript have separate roots. Wait for their actual controls,
    // rather than assuming a fixed number of frames means both roots have committed.
    nextFrame(() => {
      if (surface && ["effort", "workMode", "permissionMode", "model", "space"].includes(surface)) {
        const ids: Record<string, string> = { effort: "selectEffort", workMode: "selectWorkMode", permissionMode: "selectPermission", model: "selectModel", space: "selectSpace" }
        const scope = JSON.stringify([demo.workspace, demo.space, demo.threadId])
        whenRendered(`#${ids[surface]}${surface === "effort" ? "" : `[data-menu-scope=${JSON.stringify(scope)}]`}:not(:disabled)`, node => { if (surface === "model" || surface === "space") node.click(); else node.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
      } else if (surface === "sessionTools") {
        whenRendered(`#slashCommandsHost[data-thread-id=${JSON.stringify(demo.threadId ?? "")}]`, () => {
          const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!
          prompt.value = "/"; prompt.dispatchEvent(new Event("input", { bubbles: true }))
          const kind = demo.sessionTools.catalog?.kind
          const command = demo.sessionTools.sideQuestion ? "ask" : search.scenario === "sessionDirectories" ? "directories" : kind || search.scenario.startsWith("catalog") ? (kind && kind !== "skills" ? "catalog" : "skills") : "rename"
          whenRendered(`[cmdk-item][data-value="${command}"]`, node => {
            node.click()
            if (kind && kind !== "skills" && kind !== "environment") whenRendered('[role="dialog"] [aria-label="目录类型"]', trigger => {
              trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
              whenRendered('[role="listbox"] [role="option"]', () => {
                document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')[catalogKinds.indexOf(kind)]!.click()
              })
            })
          })
        })
      } else if (surface === "capabilities") {
        whenRendered(`#runtimeDetails[data-state="closed"][data-thread-id=${JSON.stringify(demo.threadId ?? "")}]`, node => node.click())
      } else if (surface === "activities") {
        for (const detail of document.querySelectorAll<HTMLDetailsElement>(".workGroup, .activityMessage details")) {
          if (!detail.open) detail.querySelector<HTMLElement>(":scope > summary")?.click()
        }
      } else if (surface) {
        whenRendered(`#toggleResources[data-state="closed"][data-thread-id=${JSON.stringify(demo.threadId ?? "")}]`, node => {
          node.click()
          whenRendered(`[data-resource-tab="${surface}"]`, node => node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
        })
      }
      if (["accountProfile", "accountAvatar", "accountAvatarFailure", "accountSignOutFailure"].includes(search.scenario)) emit({ type: "showAccount" })
      if (search.scenario === "sendFailure") {
        const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!
        prompt.value = "继续检查错误恢复，并保留这段草稿。"; prompt.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })
  }
  function reset() {
    clearTimeout(refreshTimer)
    clearTimeout(loginTimer)
    document.querySelector<HTMLButtonElement>('[aria-label="返回聊天"]')?.click()
    account = accountFixture()
    if (delayedSubmission) { emit({ type: "sendResult", requestId: delayedSubmission, accepted: false }); delayedSubmission = null }
    for (const id of frames) cancelAnimationFrame(id)
    frames.clear(); imageAttempts.clear()
    for (const cancel of pendingElements) cancel()
    document.querySelector<HTMLButtonElement>("#closeResources")?.click()
    document.querySelector<HTMLButtonElement>('.sessionCommandDialog [data-slot="dialog-close"]')?.click()
    document.querySelector<HTMLButtonElement>('#runtimeDetails[data-state="open"]')?.click()
    document.querySelector<HTMLButtonElement>('[aria-label="返回普通对话"]')?.click()
    generation++
    selectedCode = selectionFixture(); logoutAttempts = 0
    const next = createPreviewState(search)
    demo = next.demo; panels = next.panels; activePanel = next.activePanel; surface = next.surface
    // New fixture identity clears previous disclosure/input state without a blank frame.
    demo.threadId = demo.threadId ? `preview${generation}` : null
    demo.messages = demo.messages.map(message => ({ ...message, id: `${generation}:${message.id}` }))
    if (activePanel) activePanel.id = `preview${generation}Panel`
    panelReplies.length = 0; viewActions.length = 0
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")
    if (prompt) { prompt.value = ""; prompt.dispatchEvent(new Event("input", { bubbles: true })) }
    publish()
    showSurface()
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
    if (action.type === "composerRestore") { emit({ type: "composerDraft", value: action.value, focus: false, pendingRequestId: null }); return }
    if (action.type === "composerChanged" || action.type === "contextAdded") return
    if (action.type === "ready") { ready = true; publish(); showSurface(); return }
    if (action.type === "signOut") {
      if (account.status !== "signedIn" && account.status !== "signOutFailed") return
      clearTimeout(loginTimer)
      account = { status: "signingOut" }; logoutAttempts++
      selectedCode = { current: null, pinned: [] }; demo.messages = []; demo.attachments = []; demo.phase = "disconnected"; demo.threadId = null
      emit({ type: "composerDraft", value: { draft: "" }, focus: false, pendingRequestId: null }); publish()
      loginTimer = setTimeout(() => { account = search.scenario === "accountSignOutFailure" && logoutAttempts === 1 ? { status: "signOutFailed", message: "退出登录未完成，连接已停用。请重试退出。" } : { status: "signedOut", notice: "已退出登录。" }; publish() }, 600)
      return
    }
    if (action.type === "signIn") {
      if (account.status === "signingIn" || account.status === "signedIn") return
      account = { status: "signingIn", progress: "waiting" }; publish()
      loginTimer = setTimeout(() => { account = signedIn(); publish() }, 1800)
      return
    }
    if (action.type === "cancelSignIn") { clearTimeout(loginTimer); account = { status: "signedOut", notice: "已取消登录，可随时重试。" }; publish(); return }
    if (action.type === "refreshAccount") { if (account.status === "error") account = { status: "signedOut", notice: null }; publish(); return }
    if (action.type === "pinCodeSelection") {
      if (selectedCode.current?.id === action.id) {
        selectedCode.pinned = [...selectedCode.pinned, selectedCode.current]
        selectedCode.current = action.id === "selected-code" ? { id: "second-code", label: "accountController.ts", path: "src/connection/accountController.ts", startLine: 17, endLine: 19, error: null } : null
        demo.notice = "已固定引用；模拟切换文件，当前选区已更新。"
      }
      publish(); return
    }
    if (action.type === "removeCodeSelection") { if (action.id === selectedCode.current?.id) selectedCode.current = null; selectedCode.pinned = selectedCode.pinned.filter(item => item.id !== action.id); publish(); return }
    if (action.type === "revealCodeSelection") { demo.notice = "模拟预览已收到定位请求；不会访问真实文件。"; publish(); return }
    if (action.type === "send" && ["codeSelection", "codeSelectionFailure"].includes(search.scenario)) {
      const accepted = search.scenario === "codeSelection"
      if (accepted) {
        const references = [...selectedCode.pinned, ...(selectedCode.current ? [selectedCode.current] : [])].filter(item => action.selectionIds?.includes(item.id))
        const text = references.reduce((draft, reference) => appendContext(draft, codePrompt("addToContext", { ...reference, language: "typescript", text: reference.id === "selected-code" ? "export interface SettingsPersistence {\n  pendingSettings(): Settings\n  savePendingSettings(value: Settings): Promise<void>\n  load(): Promise<Settings | null>\n  save(value: Settings): Promise<void>\n}" : "constructor(operations: AccountOperations) {\n  this.operations = operations\n}", diagnostics: [] })), action.text)
        demo.messages = [...demo.messages, { id: action.requestId, role: "user", label: "你", text }]
        if (action.selectionIds?.includes(selectedCode.current?.id ?? "")) selectedCode.current = null
        selectedCode.pinned = selectedCode.pinned.filter(item => !action.selectionIds?.includes(item.id))
      }
      demo.notice = accepted ? "模拟发送成功，已附带选中代码。" : "模拟发送失败，草稿和代码选区已保留。"
      emit({ type: "sendResult", requestId: action.requestId, accepted }); publish(); return
    }
    if (action.type === "send") {
      if (search.scenario !== "firstSend" || demo.phase !== "disconnected") { emit({type:"sendResult",requestId:action.requestId,accepted:false}); return }
      // Slow connection fixture: the outgoing bubble must precede any async completion.
      demo.messages = [{ id: action.requestId, role: "user", label: "你", text: action.text }]
      delayedSubmission = action.requestId
      demo.phase = "connecting"
      publish()
      const owner = generation
      refreshTimer = setTimeout(() => {
        if (owner !== generation) return
        demo.phase = "running"; demo.threadId = "first-send-fixture"
        demo.space = "研发团队"; demo.workspace = "codem-plugin"; demo.model = "Auto"
        publish()
        delayedSubmission = null
        emit({type:"sendResult",requestId:action.requestId,accepted:true})
      }, 2000)
      return
    }
    if (action.type === "loadImage") {
      const attempt = (imageAttempts.get(action.id) ?? 0) + 1
      imageAttempts.set(action.id, attempt)
      emit({ type: "imageResult", id: action.id, preview: attempt === 1 ? { kind: "unavailable", reason: "模拟加载失败，请重试" } : { kind: "image", dataUrl: previewImage } }); return
    }
    if (action.type === "searchFiles") { emit({type:"fileSearchResult",requestId:action.requestId,files:action.query==="missing"?[]:[{id:"fileFixture",label:"src/main.ts"}],error:null}); return }
    if (action.type === "selectFile") { demo.attachments=[{id:"fileFixture",label:"src/main.ts",kind:"file",preview:{kind:"none"}}]; publish(); emit({type:"fileSelected",requestId:action.requestId,accepted:true}); return }
    if (action.type === "setEffort") { demo.effort = action.effort; publish(); return }
    if (action.type === "setWorkMode") { demo.workMode = action.workMode; publish(); return }
    if (action.type === "setPermission") {
      if (action.permission !== "yolo" || demo.permission === "yolo") { demo.permission = action.permission; publish(); return }
      permissionReturnPhase = demo.phase; demo.phase = "configuring"
      activePanel = { ...panels.approval!, id: "fullAccess", title: "启用完全访问？", description: "任务将跳过工具权限审批执行操作。仅对你信任的任务启用。", detail: null, choices: [{ id: "cancel", label: "保持当前权限", description: "", selected: false }, { id: "confirm", label: "启用完全访问", description: "", selected: false }] }
      publish(); return
    }
    if (action.type === "chooseModel" || action.type === "chooseSpace") {
      const choices = action.type === "chooseModel" ? demo.composerCatalog.models : demo.composerCatalog.spaces
      const choice = choices.find(item => item.id === action.id)
      if (choice) { choices.forEach(item => { item.selected = item.id === choice.id }); if (action.type === "chooseModel") demo.model = choice.label; else demo.space = choice.label }
      publish(); return
    }
    if (action.type === "pasteImages") {
      if (action.scope !== attachmentScope(demo)) { emit({ type: "pasteImagesResult", requestId: action.requestId, error: "会话已切换，请重新粘贴图片。" }); return }
      const images = parsePastedImages(action.images)
      demo.attachments = [...demo.attachments, ...images.map(image => ({ id: crypto.randomUUID(), label: "粘贴图片.png", kind: "image" as const, preview: { kind: "image" as const, dataUrl: `data:${image.mediaType};base64,${image.data}` } }))]
      publish(); emit({ type: "pasteImagesResult", requestId: action.requestId, error: null }); return
    }
    if (action.type === "pickAttachment") { demo.notice = "已请求本地文件选择（模拟），未连接 Core。"; publish(); return }
    if (action.type === "refreshSpaces") { demo.notice = "已刷新空间列表（模拟）。"; publish(); return }
    if (action.type === "panelReply") {
      panelReplies.push(action)
      const choice = !action.cancelled ? activePanel?.choices.find(item => item.id === action.choiceIds[0]) : undefined
      if (activePanel?.id === "fullAccess") {
        if (choice?.id === "confirm") demo.permission = "yolo"
        activePanel = null; demo.phase = permissionReturnPhase!; permissionReturnPhase = null; publish(); return
      }
      if (!action.cancelled && activePanel?.backChoiceId && action.choiceIds.includes(activePanel.backChoiceId)) {
        activePanel = { ...structuredClone(panels.question!), id: `questionPrevious${generation}`, title: "实现方向 · 1/2", confirmLabel: "下一题" }
      } else if (!action.cancelled && activePanel?.kind === "question" && activePanel.confirmLabel === "下一题") {
        activePanel = { ...structuredClone(panels.questionBack!), id: `questionNext${generation}` }
      } else if (!action.cancelled && activePanel?.kind === "rewind" && activePanel.confirmLabel === "继续") {
        activePanel = { ...activePanel, id: `rewindScope${generation}`, title: "确认回退范围", confirmLabel: "确认回退", choices: [{ id: "conversation", label: "只回退对话", description: "保留工作区文件（模拟）", selected: true }, { id: "both", label: "对话与文件", description: "同时恢复检查点（模拟）", selected: false }] }
      } else activePanel = null
      demo.phase = activePanel ? (["rewind"].includes(activePanel.kind) ? "configuring" : "running") : "ready"
    }
    if (action.type === "showHistory") demo.history = {...demo.history, open:true, entries:[{id:"preview",title:"整理登录页面",startedAt:"2026-09-19T12:00:00Z",turnCount:1,archived:false}]}
    if (action.type === "closeHistory") demo.history.open = false
    if (action.type === "removeAttachment") demo.attachments = demo.attachments.filter(item => item.id !== action.id)
    if (action.type === "newChat") { selectedCode = { current: null, pinned: [] }; demo.messages = []; demo.attachments = []; demo.turnTimings = []; demo.threadId = null; demo.notice = null; activePanel = null; demo.phase = "ready" }
    if (action.type === "stop") { demo.messages = demo.messages.map(item => (item.role === "tool" || item.role === "reasoning") && item.status === "running" ? { ...item, status: "interrupted" } : item); demo.turnTimings = demo.turnTimings.map(item => ({ ...item, finishedAt: item.finishedAt ?? Date.now() })); demo.phase = "ready"; activePanel = null; demo.notice = "已停止（模拟）。" }
    if (action.type === "connect") { demo.phase = "ready"; demo.space = "研发团队"; demo.workspace = "codem-plugin"; demo.model = "Auto"; demo.notice = "已恢复连接（模拟），未启动 Core。" }
    if (action.type === "refreshHistory") { demo.history = { ...demo.history, loading: false, error: null }; demo.notice = "已刷新当前样例的历史列表。" }
    if (action.type === "reloadHistory") { demo.historyNeedsRefresh = false; demo.notice = "已重新加载样例记录。" }
    if (action.type === "moreThreads") { demo.history.hasMore = false; demo.notice = "样例中的历史列表已全部加载。" }
    if (action.type === "cancelSideQuestion" && demo.sessionTools.sideQuestion) { demo.sessionTools.sideQuestion.status = "interrupted"; demo.phase = "ready" }
    if (action.type === "steer" || action.type === "askSideQuestion" || action.type === "shellCommand") {
      const accepted = search.scenario !== "commandFailure"
      demo.sessionTools.result = { requestId: action.requestId, accepted }
      demo.notice = accepted ? "已接收输入（模拟），未请求真实模型或执行命令。" : "输入提交失败（模拟）。内容保留，可以重试。"
      if (accepted && action.type === "askSideQuestion") demo.sessionTools.sideQuestion = { question: action.text, answer: "这是旁路提问的模拟回答。", status: "completed" }
    }
    if (action.type === "manageThread" || action.type === "compactThread" || action.type === "clearThread") {
      demo.sessionTools.result = { requestId: action.requestId, accepted: true }
      demo.notice = "会话操作已确认（模拟），未修改真实记录。"
    }
    if (action.type === "rewindThread") { activePanel = structuredClone(contentScenario("rewind")!.panel!); demo.phase = "configuring" }
    if (action.type === "loadCatalog") {
      applyPreviewCatalog(demo, action.kind); demo.sessionTools.busy = null; demo.notice = null
    }
    if (action.type === "loadMoreLiveSnapshot") {
      const catalog = demo.sessionTools.catalog
      if (catalog?.kind === "live" && catalog.snapshotId === action.snapshotId && catalog.pages && !catalog.loading && !catalog.stale) {
        const page = catalog.pages[action.kind]
        if (page.hasMore) {
          const index = page.rows.length + 1
          page.rows = [...page.rows, { label: action.kind === "turns" ? `轮次 ${index}` : `项目 ${index} · agentMessage`, detail: "completed" }]
          page.hasMore = page.rows.length < page.total
          catalog.snapshotId = crypto.randomUUID()
        }
      }
    }
    if (action.type === "cancelLiveSnapshot") {
      const catalog = demo.sessionTools.catalog
      if (catalog?.kind === "live" && catalog.snapshotId === action.snapshotId) { catalog.loading = null; catalog.snapshotId = crypto.randomUUID(); demo.sessionTools.busy = null }
    }
    if (action.type === "openArtifact" || action.type === "openDiff" || action.type === "openChangedFile" || action.type === "openBackgroundLog") demo.notice = "模拟预览已收到打开请求；不会访问真实文件或外部链接。"
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
  return { select, reset, dispose: () => { generation++; clearTimeout(refreshTimer); clearTimeout(loginTimer); for (const id of frames) cancelAnimationFrame(id); frames.clear(); for (const cancel of pendingElements) cancel() } }
}
