import { useState } from "react"
import { createRoot } from "react-dom/client"
import { FileDiffIcon, FolderKanbanIcon, TerminalIcon, WrenchIcon, RefreshCwIcon, Settings2Icon, SearchIcon, XIcon } from "lucide-react"
import type { ChatSnapshot, ViewAction } from "../../src/messages.ts"
import { Button } from "./button.tsx"
import { Input } from "./input.tsx"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.tsx"

interface Props { state: ChatSnapshot; post: (action: ViewAction) => void }
const taskLabels = { queued: "等待唤醒", started: "已唤醒", skipped: "已跳过", cancelled: "已取消", notFound: "已不存在", noop: "无需取消" }
function Empty({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div className="toolEmpty">{icon}<strong>{title}</strong><p>{children}</p></div>
}

function ResourceTools({ state, post }: Props) {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState("files")
  const [query, setQuery] = useState("")
  const ready = state.phase === "ready" && !state.backgroundBusy && !state.sessionTools.busy
  const blocked = state.backgroundBusy || ["disconnected", "connecting", "configuring"].includes(state.phase)
  const filteredTools = state.tools.filter(name => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button id="toggleResources" data-thread-id={state.threadId ?? ""} className="toolPanelTrigger" variant="ghost" size="icon" title="文件与工具" aria-label="文件与工具"><FolderKanbanIcon aria-hidden="true" /></Button></DialogTrigger>
    <DialogContent id="activityPanel" className="toolDialog resourceToolsDialog" showCloseButton={false}>
      <div className="toolDialogHeading"><span className="toolDialogIcon"><FolderKanbanIcon aria-hidden="true" /></span><div><DialogTitle>文件与工具</DialogTitle><DialogDescription>当前会话的文件变更、后台任务与可用工具</DialogDescription></div></div>
      <DialogClose asChild><Button id="closeResources" className="toolDialogClose" variant="ghost" size="icon" aria-label="关闭文件与工具"><XIcon aria-hidden="true" /></Button></DialogClose>
      {state.notice && <p className="toolPanelNotice" role="status">{state.notice}</p>}
      {(state.backgroundBusy || state.phase === "configuring") && <p className="toolPanelNotice" role="status">正在处理…</p>}
      <Tabs value={section} onValueChange={setSection} className="toolTabs">
        <TabsList aria-label="资源分类">
          <TabsTrigger data-resource-tab="files" value="files" aria-label="文件"><FileDiffIcon aria-hidden="true" />文件<span className="toolCount" aria-hidden="true">{state.diffs.length}</span></TabsTrigger>
          <TabsTrigger data-resource-tab="background" value="background" aria-label="任务"><TerminalIcon aria-hidden="true" />任务<span className="toolCount" aria-hidden="true">{state.background.length + state.backgroundTasks.length}</span></TabsTrigger>
          <TabsTrigger data-resource-tab="tools" value="tools" aria-label="工具"><WrenchIcon aria-hidden="true" />工具<span className="toolCount" aria-hidden="true">{state.tools.length}</span></TabsTrigger>
        </TabsList>
        <TabsContent value="files" data-resource-section="files" className="toolTabBody">
          <div className="toolSectionHeading"><h3>文件差异</h3><p>查看修改内容，或在编辑器中打开文件。</p></div>
          <div id="diffs" className="toolCardList">{state.diffs.map(diff => <article className="toolResourceCard" key={diff.id}>
            <div className="toolResourceTitle"><FileDiffIcon aria-hidden="true" /><strong>{diff.label}</strong></div>
            <div className="toolResourceMeta"><span className="diffAdded">+{diff.added}</span><span className="diffRemoved">−{diff.removed}</span>{diff.preview !== "complete" && <span>{{ partial: "部分差异", "raw-partial": "部分差异", binary: "二进制", omitted: "无预览" }[diff.preview]}</span>}</div>
            <div className="sessionToolActions"><Button variant="outline" size="sm" disabled={!diff.available} onClick={() => post({ type: "openDiff", id: diff.id })}>查看差异</Button><Button variant="ghost" size="sm" disabled={!diff.available} onClick={() => post({ type: "openChangedFile", id: diff.id })}>打开文件</Button></div>
          </article>)}</div>
          {!state.diffs.length && <Empty icon={<FileDiffIcon aria-hidden="true" />} title="尚无文件差异">会话产生的文件变更会显示在这里。</Empty>}
        </TabsContent>
        <TabsContent value="background" data-resource-section="background" className="toolTabBody">
          <div className="toolSectionHeading"><h3>后台任务</h3><p>查看进程日志，管理终端与唤醒任务。</p></div>
          <div className="sessionToolActions toolSectionToolbar"><Button id="refreshBackground" variant="outline" size="sm" disabled={blocked} onClick={() => post({ type: "refreshBackground" })}><RefreshCwIcon aria-hidden="true" />刷新</Button><Button id="cleanBackground" variant="ghost" size="sm" disabled={blocked} onClick={() => post({ type: "cleanBackground" })}>清理终端</Button></div>
          <div id="background" className="toolCardList">{state.background.map(terminal => <article className="toolResourceCard" key={terminal.id}>
            <div className="toolResourceTitle"><TerminalIcon aria-hidden="true" /><strong>{terminal.label}</strong><span className="toolStatus" data-running={terminal.inProgress}>{terminal.inProgress ? "运行中" : "已退出"}</span></div>
            <div className="sessionToolActions"><Button variant="outline" size="sm" disabled={blocked} onClick={() => post({ type: "openBackgroundLog", id: terminal.id })}>日志</Button>{terminal.inProgress && <Button variant="ghost" size="sm" disabled={blocked} onClick={() => post({ type: "terminateBackground", id: terminal.id })}>终止</Button>}</div>
          </article>)}</div>
          {!state.background.length && <p className="toolEmptyCompact">尚无后台进程</p>}
          <div id="backgroundTasks" className="toolCardList">{state.backgroundTasks.map(task => <article className="toolResourceCard" key={task.id}>
            <div className="toolResourceTitle"><strong>{task.label}</strong><span className="toolStatus">{taskLabels[task.phase]}</span></div>
            {(task.phase === "queued" || task.phase === "started") && <div className="sessionToolActions"><Button variant="outline" size="sm" disabled={blocked} onClick={() => post({ type: "cancelBackgroundTask", id: task.id })}>取消任务</Button></div>}
          </article>)}</div>
          {!state.backgroundTasks.length && <p className="toolEmptyCompact">尚无唤醒任务</p>}
        </TabsContent>
        <TabsContent value="tools" data-resource-section="tools" className="toolTabBody">
          <div className="toolSectionHeading"><h3>MCP 与工具</h3><p>工具按需发现，列表不代表服务器连接状态。</p></div>
          <div className="toolMcpCard"><div id="mcpNames">{state.mcpNames.length ? state.mcpNames.map(name => <span className="toolServer" key={name}>{name}</span>) : <span>未启用额外 MCP 服务器</span>}</div><Button id="manageMcp" variant="ghost" size="sm" disabled={!ready} onClick={() => post({ type: "manageMcp" })}><Settings2Icon aria-hidden="true" />管理 MCP</Button></div>
          <div className="toolSectionToolbar sessionToolActions"><div className="toolSearch"><SearchIcon aria-hidden="true" /><Input type="search" aria-label="搜索已加载的工具" placeholder="搜索已加载的工具…" value={query} onChange={event => setQuery(event.target.value)} /></div><Button id="refreshTools" variant="outline" size="sm" disabled={!ready} onClick={() => post({ type: "refreshTools" })}><RefreshCwIcon aria-hidden="true" />加载可用工具</Button></div>
          <div id="tools" className="toolNameList">{filteredTools.map(name => <div className="toolCatalogEntry" key={name}><WrenchIcon aria-hidden="true" /><span>{name}</span></div>)}</div>
          {!state.tools.length ? <Empty icon={<WrenchIcon aria-hidden="true" />} title="尚未加载工具">加载可用工具，或在对话中请求使用服务器。</Empty> : !filteredTools.length && <Empty icon={<SearchIcon aria-hidden="true" />} title="没有匹配的工具">换一个关键词试试。</Empty>}
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>
}

export function createResourceTools(host: HTMLElement, post: Props["post"]) {
  const root = createRoot(host)
  return (state: ChatSnapshot) => root.render(<ResourceTools key={JSON.stringify([state.workspace, state.space, state.threadId])} state={state} post={post} />)
}
