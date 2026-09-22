import { catalogKinds, type CatalogKind } from "@codem/protocol"
import { LiveSnapshotView } from "./liveSnapshotView.tsx"
import { useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { SlidersHorizontalIcon } from "lucide-react"
import type { ChatSnapshot, ViewAction } from "../../src/shared/messages.ts"
import { type ThreadOperation } from "../../src/shared/capabilityTypes.ts"
import { sessionCommands, type SessionPanelCommand } from "../../src/shared/sessionCommands.ts"
import { Button } from "../components/ui/button.tsx"
import { Input } from "../components/ui/input.tsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog.tsx"
const catalogLabels: Record<CatalogKind, string> = { skills: "技能", environment: "运行环境", config: "配置概览", hooks: "Hooks", plugins: "插件", permissions: "权限档案", spaces: "Core 空间快照", provider: "模型能力", live: "实时线程快照", tools: "工具" }
const operationDescriptions: Record<ThreadOperation, string> = { rename: "为当前会话设置新名称。", fork: "创建当前会话的独立副本。", archive: "归档当前会话，可在之后解除归档。", unarchive: "选择已归档会话，恢复为可继续对话的会话。", delete: "将永久删除此会话，无法恢复。" }
const operationLabels: Record<ThreadOperation, string> = { rename: "重命名", fork: "分叉", archive: "归档", unarchive: "解除归档", delete: "删除" }
type Request = { kind: "command"; command: SessionPanelCommand } | { kind: "shell"; text: string; confirm: () => void }
interface Props { state: ChatSnapshot; request: Request; post: (action: ViewAction) => void; close: () => void; focus: () => void }
function SessionCommandPanel({ state, request, post, close, focus }: Props) {
  const command = request.kind === "command" ? request.command : "shell"
  const [catalog, setCatalog] = useState<CatalogKind>(command === "catalog" ? "environment" : "skills")
  const currentTitle = state.history.entries.find(entry => entry.id === state.threadId)?.title ?? state.messages.find(message => message.role === "user")?.text ?? "未命名会话"
  const [target, setTarget] = useState("")
  const [name, setName] = useState(command === "rename" ? currentTitle.slice(0, 160) : "")
  const submitted = useRef(false)
  const tools = state.sessionTools
  const ready = state.phase === "ready" && !state.backgroundBusy && !tools.busy
  const running = state.phase === "running" && !tools.busy
  const targets = state.history.entries.filter(entry => entry.archived)
  const targetId = command === "unarchive" ? targets.find(entry => entry.id === target)?.id : state.threadId
  const chosenSkill = tools.skills.find(skill => skill.id === tools.selectedSkill)
  const manage = ["rename", "fork", "archive", "unarchive", "delete"].includes(command) ? command as ThreadOperation : null
  const catalogPanel = command === "catalog" || command === "skills"
  const detailPanel = catalogPanel || command === "directories"
  const title = command === "shell" ? "确认执行 Shell 命令" : sessionCommands.find(item => item.id === command)!.label
  function execute() {
    if (!ready || submitted.current) return
    if (manage && (!targetId || (manage === "rename" && !name.trim()))) return
    submitted.current = true
    const requestId = crypto.randomUUID()
    if (request.kind === "shell") { close(); request.confirm(); return }
    if (manage && targetId) {
      close(); post({ type: "manageThread", operation: manage, threadId: targetId, name: manage === "rename" ? name.trim() : "", requestId })
    } else if (state.threadId && (command === "compact" || command === "clear" || command === "rewind")) {
      close(); post({ type: ({ compact: "compactThread", clear: "clearThread", rewind: "rewindThread" } as const)[command], threadId: state.threadId, requestId })
    }
  }
  return <Dialog open onOpenChange={value => { if (!value) close() }}>
    <DialogContent className={`toolDialog sessionCommandDialog ${detailPanel ? "sessionCommandCatalog" : `sessionCommandConfirm ${command === "shell" ? "sessionCommandShell" : ""}`}`} onCloseAutoFocus={event => { event.preventDefault(); focus() }}>
      <div className="toolDialogHeading">{detailPanel && <span className="toolDialogIcon"><SlidersHorizontalIcon aria-hidden="true" /></span>}<div><DialogTitle>{title}</DialogTitle><DialogDescription>{manage ? operationDescriptions[manage] : `${state.workspace ?? "未连接工作区"} · ${state.space ?? "未选择空间"}`}</DialogDescription></div></div>
      <div className="sessionCommandBody" aria-busy={Boolean(tools.busy)}>
        {detailPanel && state.notice && <p role="status">{state.notice}</p>}{tools.busy && <p role="status">正在处理…</p>}
        {catalogPanel ? <div className="sessionToolSection">
            <div className="sessionToolActions"><Select value={catalog} onValueChange={value => { if (tools.catalog?.kind === "live" && tools.catalog.loading) post({ type: "cancelLiveSnapshot", snapshotId: tools.catalog.snapshotId }); setCatalog(value as CatalogKind) }}><SelectTrigger aria-label="目录类型"><SelectValue /></SelectTrigger><SelectContent>{catalogKinds.map(kind => <SelectItem key={kind} value={kind}>{catalogLabels[kind]}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" disabled={(!ready && !running) || Boolean(tools.busy)} onClick={() => post({ type: "loadCatalog", kind: catalog })}>刷新目录</Button></div>
            {catalog === "skills" && <><Select value={tools.selectedSkill ?? "none"} onValueChange={id => post({ type: "selectSkill", id: id === "none" ? null : id })} disabled={!ready}><SelectTrigger aria-label="下一条消息使用的技能"><SelectValue placeholder="不指定技能" /></SelectTrigger><SelectContent><SelectItem value="none">不指定技能</SelectItem>{tools.skills.map(skill => <SelectItem key={skill.id} value={skill.id}>{skill.name}</SelectItem>)}</SelectContent></Select><p>{chosenSkill ? `下一条消息作为 ${chosenSkill.name} 的参数发送；请移除附件。` : "刷新技能目录后，可选择下一条消息使用的技能。"}</p></>}
            {tools.catalog?.kind === catalog ? tools.catalog.kind === "live" ? <LiveSnapshotView view={tools.catalog} disabled={!ready && !running} post={post} /> : <><p>{tools.catalog.stale ? "结果已过期，请刷新。" : `${tools.catalog.rows.length} 项`}</p><dl className="catalogRows">{tools.catalog.rows.map((row, index) => <div key={index}><dt>{row.label}</dt><dd>{row.detail}</dd></div>)}</dl></> : <p>按需加载，不在打开面板时自动请求。</p>}
        </div> : command === "directories" ? <div className="sessionToolSection">
            <p>仅作用于当前连接，重载后重新选择。目录附件不授予此范围。</p>
            <Button variant="outline" size="sm" disabled={!ready} onClick={() => post({ type: "addDirectory" })}>添加工作目录</Button>
            {!tools.directories.length && <p className="toolEmptyCompact">尚未添加额外目录</p>}
            {tools.directories.map(directory => <div className="toolDirectoryRow" key={directory.id}><span>{directory.label}</span><Button variant="ghost" size="sm" disabled={!ready} onClick={() => post({ type: "removeDirectory", id: directory.id })}>移除</Button></div>)}
        </div> : <section aria-label="确认操作" className="sessionToolSection">
          {manage && manage !== "unarchive" && <strong className="sessionTargetTitle">{currentTitle}</strong>}
          {manage === "rename" && <Input aria-label="新的会话名称" placeholder="新的会话名称" value={name} maxLength={160} onChange={event => setName(event.target.value)} />}
          {manage === "unarchive" && <>
            <div className="sessionToolActions"><Select value={targetId ?? ""} onValueChange={setTarget} disabled={!ready}><SelectTrigger aria-label="操作目标会话"><SelectValue placeholder="选择已归档会话" /></SelectTrigger><SelectContent>{targets.map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.title}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" disabled={!ready || state.history.loading} onClick={() => post({ type: "refreshHistory" })}>{state.history.loading ? "正在加载…" : "加载会话列表"}</Button></div>
            {state.history.error && <p role="alert">{state.history.error}</p>}
            {!targets.length && <p>当前列表中没有已归档会话，可加载会话列表。</p>}
          </>}
          {request.kind === "shell" && <><p>确认后将在当前会话中执行以下命令。</p><pre>{request.text}</pre></>}
          {command === "clear" && <p>开始新上下文，当前附件和资源句柄将被清理。</p>}
          {command === "compact" && <p>整理当前上下文，完成后重新读取会话记录。</p>}
          {command === "rewind" && <p>下一步选择 Core 提供的检查点和回退范围，再确认执行。</p>}
          <div className="sessionToolActions sessionConfirmActions"><Button type="button" variant="outline" size="sm" onClick={close}>取消</Button><Button type="button" variant={command === "delete" || command === "clear" || command === "shell" ? "destructive" : "outline"} size="sm" disabled={!ready || (manage ? !targetId || (manage === "rename" && !name.trim()) : !state.threadId)} onClick={execute}>{command === "rewind" ? "选择检查点" : manage ? `确认${operationLabels[manage]}` : "确认执行"}</Button></div>
        </section>}
      </div>
    </DialogContent>
  </Dialog>
}
export function createSessionCommandPanel(host: HTMLElement, post: Props["post"], focus: () => void) {
  const root = createRoot(host)
  let state: ChatSnapshot
  let request: Request | null = null
  let sequence = 0
  let scope = ""
  function close() {
    const catalog = state.sessionTools.catalog
    if (catalog?.kind === "live" && catalog.loading) post({ type: "cancelLiveSnapshot", snapshotId: catalog.snapshotId })
    request = null; render()
  }
  function render() { root.render(request ? <SessionCommandPanel key={`${scope}:${sequence}`} state={state} request={request} post={post} close={close} focus={focus} /> : null) }
  return {
    open(command: SessionPanelCommand) { request = { kind: "command", command }; sequence++; render() },
    confirmShell(text: string, confirm: () => void) { request = { kind: "shell", text, confirm }; sequence++; render() },
    update(next: ChatSnapshot) { const nextScope = JSON.stringify([next.workspace, next.space, next.threadId]); if (scope !== nextScope) request = null; scope = nextScope; state = next; render() },
  }
}
