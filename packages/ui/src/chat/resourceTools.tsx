import { useState, type ReactNode } from "react"
import { ExternalLinkIcon, FileDiffIcon, FolderKanbanIcon, RefreshCwIcon, SearchIcon, Settings2Icon, TerminalIcon, WrenchIcon, XIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../components/ui/dialog.tsx"
import { Input } from "../components/ui/input.tsx"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.tsx"
import type { ChatSnapshot } from "../contract.ts"

const taskLabels = { queued: "等待唤醒", started: "已唤醒", skipped: "已跳过", cancelled: "已取消", notFound: "已不存在", noop: "无需取消" } as const
const previewLabels = { partial: "部分差异", "raw-partial": "部分差异", binary: "二进制", omitted: "无预览", missing: "无预览", complete: "" } as const

function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="toolEmpty">{icon}<strong>{title}</strong><p>{children}</p></div>
}

function FilePath({ label }: { label: string }) {
  const separator = Math.max(label.lastIndexOf("/"), label.lastIndexOf("\\"))
  return (
    <span className="resourceFilePath" title={label}>
      {separator >= 0 ? <span className="resourceFileDirectory">{label.slice(0, separator)}</span> : null}
      <span className="resourceFileBasename">{label.slice(separator >= 0 ? separator : 0)}</span>
    </span>
  )
}

/** 对照 VS Code resourceTools：文件、任务、工具三个页签。打开本身不请求 Host。 */
export function ResourceTools({ snapshot, post }: { snapshot: ChatSnapshot; post: (action: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState("files")
  const [query, setQuery] = useState("")
  const ready = snapshot.phase === "ready" && !snapshot.backgroundBusy && !snapshot.sessionTools.busy
  const blocked = snapshot.backgroundBusy || ["disconnected", "connecting", "configuring"].includes(snapshot.phase)
  const filtered = snapshot.tools.filter((name) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button id="toggleResources" data-thread-id={snapshot.threadId ?? ""} variant="toolbar" size="toolbarIcon" title="文件与工具" aria-label="文件与工具">
          <FolderKanbanIcon aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent id="activityPanel" className="toolDialog resourceToolsDialog" showCloseButton={false}>
        <div className="toolDialogHeading">
          <span className="toolDialogIcon"><FolderKanbanIcon aria-hidden="true" /></span>
          <div>
            <DialogTitle>文件与工具</DialogTitle>
            <DialogDescription>当前会话的文件变更、后台任务与可用工具</DialogDescription>
          </div>
        </div>
        <DialogClose asChild>
          <Button id="closeResources" className="toolDialogClose" variant="ghost" size="icon" aria-label="关闭文件与工具"><XIcon aria-hidden="true" /></Button>
        </DialogClose>
        {snapshot.notice ? <p className="toolPanelNotice" role="status">{snapshot.notice}</p> : null}
        {snapshot.backgroundBusy || snapshot.phase === "configuring" ? <p className="toolPanelNotice" role="status">正在处理…</p> : null}
        <Tabs value={section} onValueChange={setSection} className="toolTabs">
          <TabsList aria-label="资源分类">
            <TabsTrigger data-resource-tab="files" value="files" aria-label="文件"><FileDiffIcon aria-hidden="true" />文件<span className="toolCount" aria-hidden="true">{snapshot.diffs.length}</span></TabsTrigger>
            <TabsTrigger data-resource-tab="background" value="background" aria-label="任务"><TerminalIcon aria-hidden="true" />任务<span className="toolCount" aria-hidden="true">{snapshot.background.length + snapshot.backgroundTasks.length}</span></TabsTrigger>
            <TabsTrigger data-resource-tab="tools" value="tools" aria-label="工具"><WrenchIcon aria-hidden="true" />工具<span className="toolCount" aria-hidden="true">{snapshot.tools.length}</span></TabsTrigger>
          </TabsList>
          <TabsContent value="files" data-resource-section="files" className="toolTabBody">
            <div className="toolSectionHeading"><h3>文件差异</h3><p>查看修改内容，或在编辑器中打开文件。</p></div>
            <div id="diffs" className="toolDiffList">
              {snapshot.diffs.map((diff) => (
                <article className="toolDiffRow" key={diff.id}>
                  <div className="toolResourceTitle"><FileDiffIcon aria-hidden="true" /><strong><FilePath label={diff.label} /></strong></div>
                  <div className="toolResourceMeta">
                    <span className="diffAdded">+{diff.added}</span>
                    <span className="diffRemoved">−{diff.removed}</span>
                    {diff.preview !== "complete" ? <span className="toolDiffPreview" title={previewLabels[diff.preview]}>{previewLabels[diff.preview]}</span> : null}
                  </div>
                  <div className="sessionToolActions">
                    <Button variant="outline" size="sm" disabled={!diff.available} onClick={() => post({ type: "openDiff", id: diff.id })}>查看差异</Button>
                    <Button variant="ghost" size="icon" aria-label={`打开文件 ${diff.label}`} title="在编辑器中打开文件" disabled={!diff.available} onClick={() => post({ type: "openChangedFile", id: diff.id })}><ExternalLinkIcon aria-hidden="true" /></Button>
                  </div>
                </article>
              ))}
            </div>
            {!snapshot.diffs.length ? <Empty icon={<FileDiffIcon aria-hidden="true" />} title="尚无文件差异">会话产生的文件变更会显示在这里。</Empty> : null}
          </TabsContent>
          <TabsContent value="background" data-resource-section="background" className="toolTabBody">
            <div className="toolSectionHeading"><h3>后台任务</h3><p>查看进程日志，管理终端与唤醒任务。</p></div>
            <div className="sessionToolActions toolSectionToolbar">
              <Button id="refreshBackground" variant="outline" size="sm" disabled={blocked} onClick={() => post({ type: "refreshBackground" })}><RefreshCwIcon aria-hidden="true" />刷新</Button>
              <Button id="cleanBackground" variant="ghost" size="sm" disabled={blocked} onClick={() => post({ type: "cleanBackground" })}>清理终端</Button>
            </div>
            <div id="background" className="toolCardList">
              {snapshot.background.map((terminal) => (
                <article className="toolResourceCard" key={terminal.id}>
                  <div className="toolResourceTitle"><TerminalIcon aria-hidden="true" /><strong>{terminal.label}</strong><span className="toolStatus" data-running={terminal.inProgress}>{terminal.inProgress ? "运行中" : "已退出"}</span></div>
                  <div className="sessionToolActions">
                    <Button variant="outline" size="sm" disabled={blocked} onClick={() => post({ type: "openBackgroundLog", id: terminal.id })}>日志</Button>
                    {terminal.inProgress ? <Button variant="ghost" size="sm" disabled={blocked} onClick={() => post({ type: "terminateBackground", id: terminal.id })}>终止</Button> : null}
                  </div>
                </article>
              ))}
            </div>
            {!snapshot.background.length ? <p className="toolEmptyCompact">尚无后台进程</p> : null}
            <div id="backgroundTasks" className="toolCardList">
              {snapshot.backgroundTasks.map((task) => (
                <article className="toolResourceCard" key={task.id}>
                  <div className="toolResourceTitle"><strong>{task.label}</strong><span className="toolStatus">{taskLabels[task.phase]}</span></div>
                  {task.phase === "queued" || task.phase === "started" ? (
                    <div className="sessionToolActions"><Button variant="outline" size="sm" disabled={blocked} onClick={() => post({ type: "cancelBackgroundTask", id: task.id })}>取消任务</Button></div>
                  ) : null}
                </article>
              ))}
            </div>
            {!snapshot.backgroundTasks.length ? <p className="toolEmptyCompact">尚无唤醒任务</p> : null}
          </TabsContent>
          <TabsContent value="tools" data-resource-section="tools" className="toolTabBody">
            <div className="toolSectionHeading"><h3>MCP 与工具</h3><p>工具按需发现，列表不代表服务器连接状态。</p></div>
            <div className="toolMcpCard">
              <div id="mcpNames">{snapshot.mcpNames.length ? snapshot.mcpNames.map((name) => <span className="toolServer" key={name}>{name}</span>) : <span>未启用额外 MCP 服务器</span>}</div>
              <Button id="manageMcp" variant="ghost" size="sm" disabled={!ready} onClick={() => post({ type: "manageMcp" })}><Settings2Icon aria-hidden="true" />管理 MCP</Button>
            </div>
            <div className="toolSectionToolbar sessionToolActions">
              <div className="toolSearch"><SearchIcon aria-hidden="true" /><Input type="search" aria-label="搜索已加载的工具" placeholder="搜索已加载的工具…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
              <Button id="refreshTools" variant="outline" size="sm" disabled={!ready} onClick={() => post({ type: "refreshTools" })}><RefreshCwIcon aria-hidden="true" />加载可用工具</Button>
            </div>
            <div id="tools" className="toolNameList">{filtered.map((name) => <div className="toolCatalogEntry" key={name}><WrenchIcon aria-hidden="true" /><span>{name}</span></div>)}</div>
            {!snapshot.tools.length ? <Empty icon={<WrenchIcon aria-hidden="true" />} title="尚未加载工具">加载可用工具，或在对话中请求使用服务器。</Empty> : !filtered.length ? <Empty icon={<SearchIcon aria-hidden="true" />} title="没有匹配的工具">换一个关键词试试。</Empty> : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
