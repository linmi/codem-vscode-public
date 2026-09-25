import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { CheckIcon, CopyIcon, FileDiffIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { elapsedTime, type ArtifactView, type ChatMessage, type ChatSnapshot, type DiffView, type TurnTiming } from "../contract.ts"
import { LoadingState } from "./LoadingState.tsx"
import { SafeMarkdown } from "./SafeMarkdown.tsx"
import { activityBadge, activityPlaceholder, activityTitle, toolPresentation } from "./toolPresentation.ts"
import { lastActivityId, timelineGroups, workGroupState, type WorkMessage } from "./timelineGroups.ts"
import { turnChanges } from "./turnChanges.ts"
import { uiIcon } from "./uiIcons.ts"
import { UserMessageBody } from "./userMessage.tsx"


const previewLabels: Record<DiffView["preview"], string> = {
  partial: "部分差异",
  "raw-partial": "部分差异",
  binary: "二进制",
  omitted: "无预览内容",
  missing: "无预览内容",
  complete: "",
}

type Post = (action: Record<string, unknown>) => void

/**
 * 对照 VS Code messageView + workGroups：原生 details、工作分组和轮次变更。
 * 运行中的思考才放像素加载；工具行不再叠一条同样的标题。
 *
 * 每个增量都会重算分组，但消息、工作分组和轮次变更按自身输入复用上次渲染：没变的消息保持同一对象
 * （见 contract 的 normalizeMessages），只有内容、状态或工具变化的那几行重新渲染。展开状态是各行自己的 state，不受影响。
 */
export function MessageList({
  snapshot,
  post,
}: {
  snapshot: ChatSnapshot
  post: Post
}) {
  // 调用方每次渲染可能给出新的 post；各行拿到的是固定的转发函数，才能按其余输入复用。
  const latestPost = useRef(post)
  useLayoutEffect(() => { latestPost.current = post })
  const stablePost = useCallback<Post>((action) => latestPost.current(action), [])
  const groups = timelineGroups(snapshot.messages)
  const activityId = lastActivityId(snapshot.messages)
  const changes = turnChanges(snapshot.messages, snapshot.diffs)
  const nodes: { key: string; node: ReactNode }[] = []
  for (const group of groups) {
    if (group.kind === "message") {
      nodes.push({ key: group.message.id, node: <ChatMessageView message={group.message} post={stablePost} selected={snapshot.conversationSearch?.target === group.message.id} /> })
    } else {
      const latest = group.messages.some((message) => message.id === activityId)
      nodes.push({
        key: group.id,
        node: (
          <WorkGroup
            work={group.messages}
            hasResult={group.hasResult}
            phase={snapshot.phase}
            lastActivityId={latest ? activityId : null}
            timing={snapshot.turnTimings.find((item) => group.messages.some((message) => message.turnId === item.turnId))}
            post={stablePost}
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
    for (const change of placed) nodes.push({ key: `changes-${change.turnId}`, node: <TurnChangeList group={change} post={stablePost} /> })
  }
  for (const change of changes.filter((change) => !change.afterMessageId || !nodes.some((item) => item.key === `changes-${change.turnId}`))) {
    nodes.push({ key: `changes-${change.turnId}`, node: <TurnChangeList group={change} post={stablePost} /> })
  }
  return (
    <section id="messages" data-testid="messages" className="messages" role="log" aria-label="对话记录" aria-live="off" aria-busy={snapshot.phase === "loadingHistory"}>
      {nodes.map((item) => <Fragment key={item.key}>{item.node}</Fragment>)}
    </section>
  )
}

/** 消息对象不变就不重渲染。 */
const ChatMessageView = memo(function ChatMessageView({ message, post, selected }: { message: ChatMessage; post: Post; selected: boolean }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: "center" }) }, [selected])
  if (message.role === "turnStatus") {
    return <div className="turnStatus"><p role="status" data-turn-id={message.turnId}>{message.text}</p></div>
  }
  if (message.role === "reasoning" || message.role === "tool") return <ActivityItem message={message} />
  return (
    <article ref={ref} className={`message${selected ? " searchTarget" : ""}`} data-message-id={message.id} data-role={message.role} data-testid="chatMessage">
      <div className="messageLabel" hidden />
      {message.role === "user" ? <UserMessageBody text={message.text} /> : (
        <div className="messageBody chatMarkdown"><SafeMarkdown text={message.text} /></div>
      )}
      <CopyAction text={message.text} />
      <AttachmentLabels items={message.attachments} />
      <ArtifactList items={message.artifacts} post={post} />
    </article>
  )
})

interface WorkGroupProps {
  work: readonly WorkMessage[]
  hasResult: boolean
  phase: string
  /** 本组含最近一次活动时才是它的 id，否则为 null，别的分组不因最近活动换了而重渲染。 */
  lastActivityId: string | null
  timing: TurnTiming | undefined
  post: Post
}

/** 分组数组每次重算；成员对象、阶段、计时都没变就复用上次渲染。 */
function sameWorkGroup(previous: WorkGroupProps, next: WorkGroupProps): boolean {
  return previous.hasResult === next.hasResult && previous.phase === next.phase && previous.lastActivityId === next.lastActivityId && previous.post === next.post
    && previous.timing?.turnId === next.timing?.turnId && previous.timing?.startedAt === next.timing?.startedAt && previous.timing?.finishedAt === next.timing?.finishedAt
    && previous.work.length === next.work.length && previous.work.every((message, index) => message === next.work[index])
}

const WorkGroup = memo(function WorkGroup({
  work,
  hasResult,
  phase,
  lastActivityId: activityId,
  timing,
  post,
}: WorkGroupProps) {
  const state = workGroupState(work, work[0]?.id ?? "", activityId, phase, hasResult)
  const running = state === "running"
  const failed = state === "failed"
  const [touched, setTouched] = useState(false)
  const [open, setOpen] = useState(running || failed)
  const [now, setNow] = useState(() => Date.now())
  const latest = activityId !== null
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
          ? <ChatMessageView key={message.id} message={message} post={post} selected={false} />
          : <ActivityItem key={message.id} message={message} />)}
      </div>
    </details>
  )
}, sameWorkGroup)

/** 消息对象不变就不重渲染；状态或输出变化会换成新对象。 */
const ActivityItem = memo(function ActivityItem({ message }: { message: ChatMessage }) {
  const status = message.status ?? "completed"
  const thinking = message.role === "reasoning" && status === "running"
  const title = activityTitle(message)
  const [touched, setTouched] = useState(false)
  const [open, setOpen] = useState(status === "failed")
  useEffect(() => {
    if (!touched) setOpen(status === "failed")
  }, [status, touched])
  const presentation = toolPresentation(message.label ?? "工具")
  const text = message.text || activityPlaceholder(message)
  const badge = activityBadge(message)
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
})

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

interface TurnChangeProps {
  group: { turnId: string; files: readonly DiffView[] }
  post: Post
}

/** 变更行每次重算；文件与统计都没变就复用上次渲染。 */
function sameTurnChanges(previous: TurnChangeProps, next: TurnChangeProps): boolean {
  const before = previous.group.files, after = next.group.files
  return previous.post === next.post && previous.group.turnId === next.group.turnId && before.length === after.length
    && before.every((file, index) => {
      const other = after[index]!
      return file.id === other.id && file.label === other.label && file.added === other.added && file.removed === other.removed && file.preview === other.preview && file.available === other.available
    })
}

const TurnChangeList = memo(function TurnChangeList({ group, post }: TurnChangeProps) {
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
}, sameTurnChanges)
