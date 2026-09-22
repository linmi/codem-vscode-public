import { LiveSnapshotView } from "./liveSnapshotView.tsx"
import { catalogKinds, type CatalogKind } from "@codem/protocol"
import { useRef, useState } from "react"
import { SlidersHorizontalIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog.tsx"
import { Input } from "../components/ui/input.tsx"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx"
import { type ChatSnapshot, type ThreadOperation } from "../contract.ts"

const catalogLabels: Record<string, string> = { skills: "技能", environment: "运行环境", config: "配置概览", hooks: "Hooks", plugins: "插件", permissions: "权限档案", spaces: "Core 空间快照", provider: "模型能力", live: "实时线程快照", tools: "工具" }
const operationDescriptions: Record<ThreadOperation, string> = { rename: "为当前会话设置新名称。", fork: "创建当前会话的独立副本。", archive: "归档当前会话，可在之后解除归档。", unarchive: "选择已归档会话，恢复为可继续对话的会话。", delete: "将永久删除此会话，无法恢复。" }
const operationLabels: Record<ThreadOperation, string> = { rename: "重命名", fork: "分叉", archive: "归档", unarchive: "解除归档", delete: "删除" }
const sessionLabels: Record<string, string> = { skills: "选择技能", catalog: "查看能力与运行目录", directories: "管理额外工作目录", compact: "压缩当前上下文", rewind: "选择回退检查点", clear: "清空并开始新上下文", rename: "重命名会话", fork: "分叉会话", archive: "归档会话", unarchive: "解除归档", delete: "删除会话记录", shell: "确认执行 Shell 命令" }

export type SessionRequest = { kind: "command"; command: string } | { kind: "shell"; text: string }

/** 对照 VS Code sessionCommandPanel。确认前不发请求，关闭不写入。 */
export function SessionCommandPanel({
  snapshot,
  request,
  close,
  post,
  onShell,
}: {
  snapshot: ChatSnapshot
  request: SessionRequest
  close: () => void
  post: (action: Record<string, unknown>) => void
  onShell?: (text: string) => void
}) {
  const command = request.kind === "command" ? request.command : "shell"
  const [catalog, setCatalog] = useState<CatalogKind>(command === "catalog" ? "environment" : "skills")
  const currentTitle = snapshot.history.entries.find((entry) => entry.id === snapshot.threadId)?.title ?? snapshot.messages.find((message) => message.role === "user")?.text ?? "未命名会话"
  const [target, setTarget] = useState("")
  const [name, setName] = useState(command === "rename" ? currentTitle.slice(0, 160) : "")
  const submitted = useRef(false)
  const tools = snapshot.sessionTools
  const ready = snapshot.phase === "ready" && !snapshot.backgroundBusy && !tools.busy
  const running = snapshot.phase === "running" && !tools.busy
  const targets = snapshot.history.entries.filter((entry) => entry.archived)
  const targetId = command === "unarchive" ? targets.find((entry) => entry.id === target)?.id : snapshot.threadId
  const chosen = tools.skills.find((skill) => skill.id === tools.selectedSkill)
  const manage = ["rename", "fork", "archive", "unarchive", "delete"].includes(command) ? command as ThreadOperation : null
  const detail = command === "catalog" || command === "skills" || command === "directories"
  const title = sessionLabels[command] ?? command
  const execute = () => {
    if (!ready || submitted.current) return
    if (manage && (!targetId || (manage === "rename" && !name.trim()))) return
    submitted.current = true
    const requestId = `req-${Date.now().toString(36)}`
    close()
    if (manage && targetId) post({ type: "manageThread", operation: manage, threadId: targetId, name: manage === "rename" ? name.trim() : "", requestId })
    else if (snapshot.threadId && (command === "compact" || command === "clear" || command === "rewind")) {
      post({ type: command === "compact" ? "compactThread" : command === "clear" ? "clearThread" : "rewindThread", threadId: snapshot.threadId, requestId })
    } else if (request.kind === "shell") onShell?.(request.text)
  }
  const view = tools.catalog?.kind === catalog ? tools.catalog : null
  const cancelLoading = () => {
    if (view?.kind === "live" && view.loading && view.snapshotId) post({ type: "cancelLiveSnapshot", snapshotId: view.snapshotId })
  }
  const dismiss = () => { cancelLoading(); close() }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss() }}>
      <DialogContent className={`toolDialog sessionCommandDialog ${detail ? "sessionCommandCatalog" : "sessionCommandConfirm"}`} onCloseAutoFocus={(event) => event.preventDefault()}>
        <div className="toolDialogHeading">
          {detail ? <span className="toolDialogIcon"><SlidersHorizontalIcon aria-hidden="true" /></span> : null}
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{manage ? operationDescriptions[manage] : `${snapshot.workspace ?? "未连接工作区"} · ${snapshot.space ?? "未选择空间"}`}</DialogDescription>
          </div>
        </div>
        <div className="sessionCommandBody" aria-busy={Boolean(tools.busy)}>
          {detail && snapshot.notice ? <p role="status">{snapshot.notice}</p> : null}
          {tools.busy ? <p role="status">正在处理…</p> : null}
          {command === "catalog" || command === "skills" ? (
            <div className="sessionToolSection">
              <div className="sessionToolActions">
                <Select value={catalog} onValueChange={(value) => { cancelLoading(); setCatalog(value as CatalogKind) }}>
                  <SelectTrigger aria-label="目录类型"><SelectValue /></SelectTrigger>
                  <SelectContent>{catalogKinds.map((kind) => <SelectItem key={kind} value={kind}>{catalogLabels[kind] ?? kind}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" size="sm" disabled={(!ready && !running) || Boolean(tools.busy) || Boolean(view?.loading)} onClick={() => post({ type: "loadCatalog", kind: catalog })}>刷新目录</Button>
              </div>
              {catalog === "skills" ? (
                <>
                  <Select value={tools.selectedSkill ?? "none"} onValueChange={(id) => post({ type: "selectSkill", id: id === "none" ? null : id })} disabled={!ready}>
                    <SelectTrigger aria-label="下一条消息使用的技能"><SelectValue placeholder="不指定技能" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不指定技能</SelectItem>
                      {tools.skills.map((skill) => <SelectItem key={skill.id} value={skill.id}>{skill.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p>{chosen ? `下一条消息作为 ${chosen.name} 的参数发送；请移除附件。` : "刷新技能目录后，可选择下一条消息使用的技能。"}</p>
                </>
              ) : null}
              {view ? view.kind === "live" ? <LiveSnapshotView view={view} disabled={!ready && !running} post={post} /> : (
                <>
                  <p>{view.stale ? "结果已过期，请刷新。" : `${view.rows.length} 项`}</p>
                  <dl className="catalogRows">{view.rows.map((row, index) => <div key={index}><dt>{row.label}</dt><dd>{row.detail}</dd></div>)}</dl>
                </>
              ) : <p>按需加载，不在打开面板时自动请求。</p>}
            </div>
          ) : command === "directories" ? (
            <div className="sessionToolSection">
              <p>仅作用于当前连接，重载后重新选择。目录附件不授予此范围。</p>
              <Button variant="outline" size="sm" disabled={!ready} onClick={() => post({ type: "addDirectory" })}>添加工作目录</Button>
              {!tools.directories.length ? <p className="toolEmptyCompact">尚未添加额外目录</p> : null}
              {tools.directories.map((directory) => (
                <div className="toolDirectoryRow" key={directory.id}><span>{directory.label}</span><Button variant="ghost" size="sm" disabled={!ready} onClick={() => post({ type: "removeDirectory", id: directory.id })}>移除</Button></div>
              ))}
            </div>
          ) : (
            <section aria-label="确认操作" className="sessionToolSection">
              {manage && manage !== "unarchive" ? <strong className="sessionTargetTitle">{currentTitle}</strong> : null}
              {manage === "rename" ? <Input aria-label="新的会话名称" placeholder="新的会话名称" value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /> : null}
              {manage === "unarchive" ? (
                <>
                  <div className="sessionToolActions">
                    <Select value={targetId ?? ""} onValueChange={setTarget} disabled={!ready}>
                      <SelectTrigger aria-label="操作目标会话"><SelectValue placeholder="选择已归档会话" /></SelectTrigger>
                      <SelectContent>{targets.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.title}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="sm" disabled={!ready || snapshot.history.loading} onClick={() => post({ type: "refreshHistory" })}>{snapshot.history.loading ? "正在加载…" : "加载会话列表"}</Button>
                  </div>
                  {snapshot.history.error ? <p role="alert">{snapshot.history.error}</p> : null}
                  {!targets.length ? <p>当前列表中没有已归档会话，可加载会话列表。</p> : null}
                </>
              ) : null}
              {request.kind === "shell" ? <><p>确认后将在当前会话中执行以下命令。</p><pre>{request.text}</pre></> : null}
              {command === "clear" ? <p>开始新上下文，当前附件和资源句柄将被清理。</p> : null}
              {command === "compact" ? <p>整理当前上下文，完成后重新读取会话记录。</p> : null}
              {command === "rewind" ? <p>下一步选择 Core 提供的检查点和回退范围，再确认执行。</p> : null}
              <div className="sessionToolActions sessionConfirmActions">
                <Button type="button" variant="outline" size="sm" onClick={close}>取消</Button>
                <Button type="button" variant={command === "delete" || command === "clear" || command === "shell" ? "destructive" : "outline"} size="sm" disabled={!ready || (manage ? !targetId || (manage === "rename" && !name.trim()) : !snapshot.threadId)} onClick={execute}>
                  {command === "rewind" ? "选择检查点" : manage ? `确认${operationLabels[manage]}` : "确认执行"}
                </Button>
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
