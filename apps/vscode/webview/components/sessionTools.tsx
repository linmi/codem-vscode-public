import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import type { ChatSnapshot, ViewAction } from "../../src/messages.ts"
import { catalogKinds, type CatalogKind, type CapabilityAction, type ThreadOperation } from "../../src/capabilityTypes.ts"
import { Button } from "./button.tsx"
import { Input } from "./input.tsx"
import { Textarea } from "./textarea.tsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select.tsx"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog.tsx"

const catalogLabels: Record<CatalogKind, string> = { skills: "技能", environment: "运行环境", config: "配置概览", hooks: "Hooks", plugins: "插件", permissions: "权限档案", spaces: "Core 空间快照", provider: "模型能力", live: "实时线程快照" }
const operationLabels: Record<ThreadOperation, string> = { rename: "重命名", fork: "分叉", archive: "归档", unarchive: "解除归档", delete: "删除" }
export interface ToolsDraft { scope: string; text: string; mode: "askSideQuestion" | "steer" | "shellCommand" }
interface Props { state: ChatSnapshot; post: (action: ViewAction) => void; draft: ToolsDraft | undefined; save: (draft: ToolsDraft) => void; scope: string }

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return <Collapsible defaultOpen><CollapsibleTrigger asChild><Button variant="ghost" size="sm">{label}</Button></CollapsibleTrigger><CollapsibleContent className="sessionToolSection">{children}</CollapsibleContent></Collapsible>
}

function SessionTools({ state, post, draft, save, scope }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(draft?.scope === scope ? draft.text : "")
  const [mode, setMode] = useState<ToolsDraft["mode"]>(draft?.scope === scope ? draft.mode : "askSideQuestion")
  const [catalog, setCatalog] = useState<CatalogKind>("skills")
  const [target, setTarget] = useState(state.threadId ?? "")
  const [name, setName] = useState("")
  const [confirmation, setConfirmation] = useState<{ label: string; detail: string; action: CapabilityAction } | null>(null)
  const pending = useRef<{ id: string; text: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const tools = state.sessionTools
  const ready = state.phase === "ready" && !state.backgroundBusy && !tools.busy
  const running = state.phase === "running" && !tools.busy
  const entries = state.history.entries
  const targets = entries.some(entry => entry.id === state.threadId) || !state.threadId ? entries : [{ id: state.threadId, title: "当前会话", archived: false }, ...entries]
  const selected = targets.find(entry => entry.id === target)
  const chosenSkill = tools.skills.find(skill => skill.id === tools.selectedSkill)
  useEffect(() => { save({ scope, text, mode }) }, [scope, text, mode, save])
  useEffect(() => {
    if (!tools.result || tools.result.requestId !== pending.current?.id) return
    const submittedText = pending.current.text
    if (tools.result.accepted) setText(current => current === submittedText ? "" : current)
    pending.current = null; setSubmitting(false)
  }, [tools.result])
  // Host busy state and request receipts survive Webview reconstruction.
  function sendText() {
    if (!state.threadId || !text.trim() || submitting) return
    const requestId = crypto.randomUUID()
    const action: CapabilityAction = { type: mode, threadId: state.threadId, text, requestId }
    if (mode === "shellCommand") { setConfirmation({ label: "执行 Shell 命令", detail: text, action }); return }
    pending.current = { id: requestId, text }; setSubmitting(true); post(action)
  }
  function confirm() {
    if (!confirmation || !ready) return
    const action = confirmation.action
    if (action.type === "shellCommand") { pending.current = { id: action.requestId, text }; setSubmitting(true) }
    post(action); setConfirmation(null)
    if (action.type !== "manageThread") setOpen(false)
  }
  function manage(operation: ThreadOperation) {
    if (!selected) return
    setConfirmation({ label: `${operationLabels[operation]}「${selected.title}」`, detail: operation === "delete" ? "删除此会话的持久记录，无法从历史列表恢复。" : operation === "fork" ? "创建独立副本，当前会话保持不变。" : operation === "rename" ? `新名称：${name.trim()}` : operation === "archive" ? "归档后停止订阅，可在历史中解除归档。" : "恢复为可继续对话的会话。", action: { type: "manageThread", operation, threadId: selected.id, name: operation === "rename" ? name.trim() : "", requestId: crypto.randomUUID() } })
  }
  function control(type: "clearThread" | "compactThread" | "rewindThread") {
    if (!state.threadId) return
    setConfirmation({ label: { clearThread: "清空并开始新上下文", compactThread: "压缩上下文", rewindThread: "回退会话" }[type], detail: type === "clearThread" ? "Core 将创建新的会话身份。当前附件和资源句柄会清理；这与仅新建空白界面不同。" : type === "rewindThread" ? "由 Core 提供检查点和回退范围，下一步选择后再执行。" : "由 Core 整理当前上下文，完成后重新读取记录。", action: { type, threadId: state.threadId, requestId: crypto.randomUUID() } })
  }
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setConfirmation(null) }}>
    <DialogTrigger asChild><Button id="sessionTools" variant="ghost" size="sm" aria-label="会话工具">会话工具</Button></DialogTrigger>
    <DialogContent className="sessionToolsDialog">
      <DialogTitle>会话工具</DialogTitle>
      <DialogDescription>当前工作区 · {state.workspace ?? "未连接"} · {state.space ?? "未选择空间"}</DialogDescription>
      <div className="sessionToolsBody" aria-busy={Boolean(tools.busy)}>
        {state.notice && <p role="status">{state.notice}</p>}
        {tools.busy && <p role="status">正在处理…</p>}
        {confirmation ? <section aria-label="确认操作" className="sessionToolSection">
          <h3>{confirmation.label}</h3><pre>{confirmation.detail}</pre>
          <div className="sessionToolActions"><Button variant="outline" size="sm" onClick={() => setConfirmation(null)}>取消</Button><Button variant="destructive" size="sm" disabled={!ready} onClick={confirm}>确认执行</Button></div>
        </section> : <>
          <Section label="会话与上下文">
            <Button variant="outline" size="sm" disabled={!ready || state.history.loading} onClick={() => post({ type: "refreshHistory" })}>加载会话列表</Button>
            {state.history.error && <p role="alert">{state.history.error}</p>}
            <Select value={selected?.id ?? ""} onValueChange={setTarget} disabled={!ready}><SelectTrigger aria-label="操作目标会话"><SelectValue placeholder="选择会话" /></SelectTrigger><SelectContent>{targets.map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.title}{entry.archived ? " · 已归档" : ""}</SelectItem>)}</SelectContent></Select>
            <Input value={name} maxLength={160} onChange={event => setName(event.target.value)} aria-label="新的会话名称" placeholder="新的会话名称" />
            <div className="sessionToolActions">
              <Button variant="outline" size="sm" disabled={!ready || !selected || !name.trim()} onClick={() => manage("rename")}>重命名</Button>
              <Button variant="outline" size="sm" disabled={!ready || !selected} onClick={() => manage("fork")}>分叉</Button>
              <Button variant="outline" size="sm" disabled={!ready || !selected} onClick={() => manage(selected?.archived ? "unarchive" : "archive")}>{selected?.archived ? "解除归档" : "归档"}</Button>
              <Button variant="destructive" size="sm" disabled={!ready || !selected} onClick={() => manage("delete")}>删除</Button>
            </div>
            <div className="sessionToolActions">{(["compactThread", "rewindThread", "clearThread"] as const).map(type => <Button key={type} variant="outline" size="sm" disabled={!ready || !state.threadId} onClick={() => control(type)}>{{ compactThread: "压缩上下文", rewindThread: "回退", clearThread: "清空上下文" }[type]}</Button>)}</div>
          </Section>
          <Section label="补充指令与旁路提问">
            <Select value={mode} onValueChange={value => setMode(value as ToolsDraft["mode"])} disabled={submitting}><SelectTrigger aria-label="输入方式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="askSideQuestion">旁路提问（主任务空闲时）</SelectItem><SelectItem value="steer">补充指令（主任务运行时）</SelectItem><SelectItem value="shellCommand">执行 Shell 命令</SelectItem></SelectContent></Select>
            <Textarea aria-label="会话工具输入" placeholder={mode === "shellCommand" ? "输入要执行的命令" : "输入你的问题或补充指令"} value={text} maxLength={32000} onChange={event => setText(event.target.value)} />
            <Button variant="outline" size="sm" disabled={!state.threadId || !text.trim() || submitting || (mode === "steer" ? !running : !ready)} onClick={sendText}>{submitting ? "正在提交…" : mode === "shellCommand" ? "检查命令" : "提交"}</Button>
            {!state.threadId && <p>先发送一条消息建立会话。</p>}
            {tools.sideQuestion && <div className="sideQuestion" aria-label="旁路问答"><p>{tools.sideQuestion.question}</p><pre>{tools.sideQuestion.answer}</pre><p role="status">{{ starting: "正在提交", running: "正在回答", stopping: "正在取消", completed: "已完成", interrupted: "已取消", failed: "失败", incomplete: "连接中断，未完成" }[tools.sideQuestion.status]}</p>{["running", "stopping"].includes(tools.sideQuestion.status) && <Button variant="outline" size="sm" disabled={tools.sideQuestion.status === "stopping"} onClick={() => post({ type: "cancelSideQuestion" })}>取消旁路提问</Button>}</div>}
          </Section>
          <Section label="技能与运行目录">
            <div className="sessionToolActions"><Select value={catalog} onValueChange={value => setCatalog(value as CatalogKind)}><SelectTrigger aria-label="目录类型"><SelectValue /></SelectTrigger><SelectContent>{catalogKinds.map(kind => <SelectItem key={kind} value={kind}>{catalogLabels[kind]}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" disabled={(!ready && !running) || Boolean(tools.busy)} onClick={() => post({ type: "loadCatalog", kind: catalog })}>刷新目录</Button></div>
            {catalog === "skills" && <><Select value={tools.selectedSkill ?? "none"} onValueChange={id => post({ type: "selectSkill", id: id === "none" ? null : id })} disabled={!ready}><SelectTrigger aria-label="下一条消息使用的技能"><SelectValue placeholder="不指定技能" /></SelectTrigger><SelectContent><SelectItem value="none">不指定技能</SelectItem>{tools.skills.map(skill => <SelectItem key={skill.id} value={skill.id}>{skill.name}</SelectItem>)}</SelectContent></Select><p>{chosenSkill ? `下一条消息作为 ${chosenSkill.name} 的参数发送；请移除附件。` : "刷新技能目录后，可选择下一条消息使用的技能。"}</p></>}
            {tools.catalog?.kind === catalog ? <><p>{tools.catalog.stale ? "结果已过期，请刷新。" : `${tools.catalog.rows.length} 项`}</p><dl className="catalogRows">{tools.catalog.rows.map((row, index) => <div key={index}><dt>{row.label}</dt><dd>{row.detail}</dd></div>)}</dl></> : <p>按需加载，不在打开面板时自动请求。</p>}
          </Section>
          <Section label="额外工作目录">
            <p>仅作用于当前连接，重载后重新选择。目录附件不授予此范围。</p>
            <Button variant="outline" size="sm" disabled={!ready} onClick={() => post({ type: "addDirectory" })}>添加工作目录</Button>
            {tools.directories.map(directory => <div className="sessionToolActions" key={directory.id}><span>{directory.label}</span><Button variant="ghost" size="sm" disabled={!ready} onClick={() => post({ type: "removeDirectory", id: directory.id })}>移除</Button></div>)}
          </Section>
        </>}
      </div>
    </DialogContent>
  </Dialog>
}

export function createSessionTools(host: HTMLElement, post: Props["post"], draft: () => ToolsDraft | undefined, save: Props["save"]) {
  const root = createRoot(host)
  return (state: ChatSnapshot) => {
    const scope = JSON.stringify([state.workspace, state.space, state.threadId])
    root.render(<SessionTools key={scope} scope={scope} state={state} post={post} draft={draft()} save={save} />)
  }
}
