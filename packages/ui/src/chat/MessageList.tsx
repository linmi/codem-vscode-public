import { Fragment, useEffect, useState, type ReactNode } from "react"
import { CheckIcon, CopyIcon, FileDiffIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { elapsedTime, type ArtifactView, type ChatMessage, type ChatSnapshot, type DiffView } from "../contract.ts"
import { LoadingState } from "./LoadingState.tsx"
import { SafeMarkdown } from "./SafeMarkdown.tsx"
import { activityTitle, toolPresentation } from "./toolPresentation.ts"
import { lastActivityId, timelineGroups, workGroupState, type WorkMessage } from "./timelineGroups.ts"
import { turnChanges } from "./turnChanges.ts"
import { uiIcon } from "./uiIcons.ts"
import { UserMessageBody } from "./userMessage.tsx"


const toolStatus = { running: "进行中", completed: "已完成", failed: "失败", declined: "已拒绝", interrupted: "已停止", incomplete: "未完成" } as const
const reasoningStatus = { running: "思考中", completed: "思考完成", interrupted: "思考已停止", incomplete: "思考未完成", failed: "思考失败", declined: "已拒绝" } as const
const previewLabels: Record<DiffView["preview"], string> = {
  partial: "部分差异",
  "raw-partial": "部分差异",
  binary: "二进制",
  omitted: "无预览内容",
  missing: "无预览内容",
  complete: "",
}

/**
 * 对照 VS Code messageView + workGroups：原生 details、工作分组和轮次变更。
 * 运行中的思考才放像素加载；工具行不再叠一条同样的标题。
 */
export function MessageList({
  snapshot,
  post,
}: {
  snapshot: ChatSnapshot
  post: (action: Record<string, unknown>) => void
}) {
  const groups = timelineGroups(snapshot.messages)
  const activityId = lastActivityId(snapshot.messages)
  const changes = turnChanges(snapshot.messages, snapshot.diffs)
  const nodes: { key: string; node: ReactNode }[] = []
  for (const group of groups) {
    if (group.kind === "message") {
      nodes.push({ key: group.message.id, node: <ChatMessageView message={group.message} post={post} /> })
    } else {
      nodes.push({
        key: group.id,
        node: (
          <WorkGroup
            work={group.messages}
            hasResult={group.hasResult}
            phase={snapshot.phase}
            lastActivityId={activityId}
            timings={snapshot.turnTimings}
            post={post}
          />
        ),
      })
    }
    const placed = changes.filter((change) => {
      const anchor = change.afterMessageId
      if (!anchor) return false
      if (group.kind === "message") return group.message.id === anchor
      return group.messages.some((message) => message.id === anchor)
    })
    for (const change of placed) nodes.push({ key: `changes-${change.turnId}`, node: <TurnChangeList group={change} post={post} /> })
  }
  for (const change of changes.filter((change) => !change.afterMessageId || !nodes.some((item) => item.key === `changes-${change.turnId}`))) {
    nodes.push({ key: `changes-${change.turnId}`, node: <TurnChangeList group={change} post={post} /> })
  }
  return (
    <section id="messages" data-testid="messages" className="messages" role="log" aria-label="对话记录" aria-live="off" aria-busy={snapshot.phase === "loadingHistory"}>
      {nodes.map((item) => <Fragment key={item.key}>{item.node}</Fragment>)}
    </section>
  )
}

function ChatMessageView({ message, post }: { message: ChatMessage; post: (action: Record<string, unknown>) => void }) {
  if (message.role === "turnStatus") {
    return <div className="turnStatus"><p role="status" data-turn-id={message.turnId}>{message.text}</p></div>
  }
  if (message.role === "reasoning" || message.role === "tool") return <ActivityItem message={message} />
  return (
    <article className="message" data-role={message.role} data-testid="chatMessage">
      <div className="messageLabel" hidden />
      {message.role === "user" ? <UserMessageBody text={message.text} /> : (
        <div className="messageBody chatMarkdown"><SafeMarkdown text={message.text} /></div>
      )}
      <CopyAction text={message.text} />
      <AttachmentLabels items={message.attachments} />
      <ArtifactList items={message.artifacts} post={post} />
    </article>
  )
}

function WorkGroup({
  work,
  hasResult,
  phase,
  lastActivityId: activityId,
  timings,
  post,
}: {
  work: readonly WorkMessage[]
  hasResult: boolean
  phase: string
  lastActivityId: string | null
  timings: ChatSnapshot["turnTimings"]
  post: (action: Record<string, unknown>) => void
}) {
  const state = workGroupState(work, work[0]?.id ?? "", activityId, phase, hasResult)
  const running = state === "running"
  const failed = state === "failed"
  const [touched, setTouched] = useState(false)
  const [open, setOpen] = useState(running || failed)
  const [now, setNow] = useState(() => Date.now())
  const latest = work.some((message) => message.id === activityId)
  const timing = timings.find((item) => work.some((message) => message.turnId === item.turnId))
  useEffect(() => {
    if (!touched) setOpen(running || failed)
  }, [running, failed, touched])
  useEffect(() => {
    if (timing?.finishedAt !== null || !running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [timing?.finishedAt, running])
  const plain = running ? (phase === "stopping" ? "正在停止" : "正在处理") : failed ? "处理需要关注" : state === "interrupted" ? "已停止或拒绝" : "已处理"
  const prefix = failed ? "处理需要关注 · " : phase === "stopping" && latest ? "正在停止 · " : state === "interrupted" ? "已停止或拒绝 · " : ""
  const heading = timing ? `${prefix}已处理 ${elapsedTime(timing, now)}` : plain
  return (
    <details
      className="workGroup"
      data-testid="workGroup"
      data-state={state}
      open={open}
    >
      <summary
        onClick={(event) => {
          event.preventDefault()
          setTouched(true)
          setOpen((value) => !value)
        }}
      >
        <span>{heading}</span>
        <span className="workGroupChevron" aria-hidden="true" dangerouslySetInnerHTML={{ __html: uiIcon("chevron") }} />
      </summary>
      <div className="workGroupContent">
        {work.map((message) => message.role === "assistant"
          ? <ChatMessageView key={message.id} message={message} post={post} />
          : <ActivityItem key={message.id} message={message} />)}
      </div>
    </details>
  )
}

function ActivityItem({ message }: { message: ChatMessage }) {
  const status = message.status ?? "completed"
  const thinking = message.role === "reasoning" && status === "running"
  const title = activityTitle(message)
  const [touched, setTouched] = useState(false)
  const [open, setOpen] = useState(status === "failed")
  useEffect(() => {
    if (!touched) setOpen(status === "failed")
  }, [status, touched])
  const presentation = toolPresentation(message.label ?? "工具")
  const empty = status === "running"
    ? (message.role === "reasoning" ? "正在思考…" : message.label === "skill" ? "正在加载技能说明…" : "等待工具输出…")
    : status === "incomplete"
      ? "未收到完成结果。"
      : message.role === "reasoning"
        ? "Core 未提供可显示的思考内容。"
        : "无文本输出。"
  const text = message.text || empty
  const badge = message.role === "reasoning" ? reasoningStatus[status] : toolStatus[status]
  const heading = message.role === "tool"
    ? (message.label === "skill" ? "技能加载结果" : message.details?.kind === "command" ? "Shell" : `${presentation.title}输出`)
    : ""
  const note = message.summary?.trim() && message.summary.trim() !== message.text.trim() && message.summary.trim() !== title.trim() ? message.summary : ""
  return (
    <article className="message activityMessage" data-role={message.role} data-status={status} data-tool={message.role === "tool" ? presentation.kind : undefined} data-testid={message.role === "reasoning" ? "thinking" : "toolCall"}>
      <details open={open}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            setTouched(true)
            setOpen((value) => !value)
          }}
        >
          <span className="activityIcon" hidden={thinking} aria-hidden="true" dangerouslySetInnerHTML={{ __html: uiIcon(message.role === "reasoning" ? "thought" : iconFor(presentation.kind)) }} />
          <span className="activityTitle" hidden={thinking} title={title}>{title}</span>
          <span className="activityLoading" hidden={!thinking}>{thinking ? <LoadingState label={title} /> : null}</span>
          <span className="activityChevron" aria-hidden="true" dangerouslySetInnerHTML={{ __html: uiIcon("chevron") }} />
          <span className={message.role === "tool" && status === "failed" ? "activityStatus visuallyHidden" : "activityStatus"} hidden={status === "running"}>{badge}</span>
        </summary>
        {note ? <p className="activityNote">{note}</p> : null}
        {message.role === "tool" ? (
          <section className="toolOutput" aria-label={heading}>
            <div className="toolOutputHeading">{heading}</div>
            {message.details ? (
              <div className="toolInputCard" data-kind={message.details.kind}>
                {message.details.code ? <pre className="toolCommand">{message.details.code}</pre> : null}
                {message.details.fields.filter((field) => field.value).map((field) => (
                  <div key={`${field.label}:${field.value}`} className="toolInputField">
                    <span>{field.label}</span>
                    <span>{field.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <div className={message.text.trim() ? "messageBody" : "messageBody emptyOutput"} aria-label={heading}>{text}</div>
          </section>
        ) : (
          <div className={message.text.trim() ? "messageBody chatMarkdown" : "messageBody chatMarkdown emptyOutput"}>
            <SafeMarkdown text={text} />
          </div>
        )}
      </details>
    </article>
  )
}

function iconFor(kind: string): Parameters<typeof uiIcon>[0] {
  if (kind === "command" || kind === "process") return "terminal"
  if (kind === "search") return "search"
  if (kind === "read" || kind === "write" || kind === "image") return "file"
  if (kind === "web") return "globe"
  if (kind === "mcp") return "plug"
  if (kind === "subagent" || kind === "plan") return "chat"
  if (kind === "task") return "check"
  if (kind === "worktree") return "folder"
  if (kind === "wait" || kind === "context") return "history"
  return "tool"
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <div className="messageActions">
      <button
        type="button"
        className="copyMessage"
        aria-label={failed ? "复制失败，点击重试" : copied ? "已复制消息" : "复制消息"}
        title="复制消息"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setFailed(false)
            window.setTimeout(() => setCopied(false), 2000)
          } catch {
            setFailed(true)
            setCopied(false)
          }
        }}
      >
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </button>
      <span className="copyFeedback" role="status">{failed ? "复制失败，点击重试" : ""}</span>
    </div>
  )
}

function AttachmentLabels({ items }: { items: ChatMessage["attachments"] }) {
  if (!items?.length) return null
  return <div className="messageAttachments">{items.map((item) => <span key={item.id} className="attachmentName">{item.label}</span>)}</div>
}

function ArtifactList({ items, post }: { items: readonly ArtifactView[] | undefined; post: (action: Record<string, unknown>) => void }) {
  if (!items?.length) return null
  return (
    <div className="messageArtifacts">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="artifactCard"
          data-kind={item.kind}
          disabled={!item.available}
          aria-label={`打开${item.kind === "diff" ? "差异" : "产物"} ${item.title}`}
          onClick={() => post({ type: item.kind === "diff" ? "openDiff" : "openArtifact", id: item.id })}
        >
          <span className="artifactIcon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: uiIcon(item.kind === "url" ? "globe" : item.kind === "chart" ? "chart" : "file") }} />
          <span><strong>{item.title}</strong><span className="artifactDetail">{item.detail}</span></span>
        </button>
      ))}
    </div>
  )
}

function TurnChangeList({
  group,
  post,
}: {
  group: { turnId: string; files: readonly DiffView[] }
  post: (action: Record<string, unknown>) => void
}) {
  const repeated = new Set(group.files.map((file) => file.label)).size < group.files.length
  return (
    <section className="turnChanges" aria-label="本轮文件变更" data-turn-id={group.turnId}>
      <div className="turnChangesHeading">
        <FileDiffIcon aria-hidden="true" />
        <strong>本轮文件变更</strong>
        <span>{group.files.length} 处</span>
      </div>
      {repeated ? <p className="turnChangesHint">同一文件的多次修改分段展示，增删数为各段统计。</p> : null}
      <ul>
        {group.files.map((file) => (
          <li key={file.id}>
            <span className="resourceFilePath" title={file.label}><span className="resourceFileBasename">{file.label}</span></span>
            <span className="turnChangeStats"><span className="diffAdded">+{file.added}</span><span className="diffRemoved">−{file.removed}</span></span>
            <div className="turnChangeActions">
              {file.preview !== "complete" ? <span title={previewLabels[file.preview]}>{previewLabels[file.preview]}</span> : null}
              {!file.available ? <span title="当前不可用">当前不可用</span> : null}
              <Button type="button" variant="ghost" size="sm" disabled={!file.available} aria-label={`查看差异 ${file.label}`} onClick={() => post({ type: "openDiff", id: file.id })}>查看差异</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
