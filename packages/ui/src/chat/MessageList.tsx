import { useState } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible.tsx"
import { elapsedTime, type ChatMessage, type ChatSnapshot } from "../contract.ts"
import { lastActivityId, timelineGroups, workGroupState, type WorkMessage } from "./timelineGroups.ts"
import { activityBadge, activityPlaceholder, activityTitle, toolPresentation } from "./toolPresentation.ts"
import { SafeMarkdown } from "./SafeMarkdown.tsx"

/**
 * 对照 VS Code 现网消息：用户气泡、思考/工具折叠、工作分组。
 * 只读 Host 投影 messages 与 assistantText，不建 transcript。
 *
 * 更改要点：去掉卡片边框；发送/生成中先画「正在处理」；收尾答复在组外。
 */
export function MessageList({ snapshot }: { snapshot: ChatSnapshot }) {
  const groups = timelineGroups(snapshot.messages)
  const activityId = lastActivityId(snapshot.messages)
  const hasWork = snapshot.messages.some((message) => message.role === "reasoning" || message.role === "tool")
  const pendingWork =
    (snapshot.phase === "sending" || snapshot.phase === "running" || snapshot.phase === "stopping") && !hasWork
  const pendingLabel =
    snapshot.phase === "stopping"
      ? "正在停止"
      : snapshot.phase === "sending"
        ? "发送中"
        : snapshot.capabilities.activity || "正在处理"
  if (groups.length === 0 && !snapshot.assistantText && !pendingWork) return null
  return (
    <section data-testid="messages" id="messages" className="messages" aria-label="对话记录" aria-busy={snapshot.phase === "connecting" || pendingWork}>
      {groups.map((group) =>
        group.kind === "message" ? (
          <ChatBubble key={group.message.id} message={group.message} />
        ) : (
          <WorkGroup
            key={group.id}
            work={group.messages}
            id={group.id}
            hasResult={group.hasResult}
            phase={snapshot.phase}
            lastActivityId={activityId}
            timings={snapshot.turnTimings}
          />
        ),
      )}
      {pendingWork ? (
        <div className="workGroup" data-testid="workGroup" data-state="running" data-open="false">
          <span className="workGroupTrigger" data-testid="workGroupTrigger">{pendingLabel}</span>
        </div>
      ) : null}
      {snapshot.assistantText ? (
        <article data-role="assistant" data-testid="streamingMessage" className="message">
          <div className="messageBody">
            <SafeMarkdown text={snapshot.assistantText} />
          </div>
        </article>
      ) : null}
    </section>
  )
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role !== "user" && message.role !== "assistant") {
    return <ActivityItem message={message} />
  }
  return (
    <article data-role={message.role} data-testid="chatMessage" className="message">
      <div className="messageBody chatMarkdown">
        <SafeMarkdown text={message.text} />
      </div>
    </article>
  )
}

function WorkGroup({
  work,
  id,
  hasResult,
  phase,
  lastActivityId: activityId,
  timings,
}: {
  work: readonly WorkMessage[]
  id: string
  hasResult: boolean
  phase: string
  lastActivityId: string | null
  timings: ChatSnapshot["turnTimings"]
}) {
  const state = workGroupState(work, id, activityId, phase, hasResult)
  const [open, setOpen] = useState(state === "running" || state === "failed")
  const timing = timings.find((item) => work.some((message) => message.turnId === item.turnId))
  const labels = {
    running: phase === "stopping" ? "正在停止" : "正在处理",
    failed: "处理需要关注",
    interrupted: "已停止或拒绝",
    completed: "已处理",
  } as const
  const heading = timing ? `${labels[state]} · ${elapsedTime(timing, Date.now())}` : labels[state]
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="workGroup"
      data-testid="workGroup"
      data-state={state}
      data-open={open}
    >
      <CollapsibleTrigger className="workGroupTrigger" data-testid="workGroupTrigger" aria-label={heading}>
        {heading}
        <span className="workGroupChevron" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="workGroupContent">
        {work.map((message) =>
          message.role === "assistant" ? <ChatBubble key={message.id} message={message} /> : <ActivityItem key={message.id} message={message} />,
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ActivityItem({ message }: { message: ChatMessage }) {
  const status = message.status ?? "completed"
  const [open, setOpen] = useState(status === "failed")
  const title = activityTitle(message)
  const kind = message.role === "reasoning" ? "thinking" : toolPresentation(message.label ?? "工具").kind
  const body = message.text.trim() || activityPlaceholder(message)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="activityMessage"
      data-testid={message.role === "reasoning" ? "thinking" : "toolCall"}
      data-role={message.role}
      data-status={status}
      data-kind={kind}
      data-tool={kind}
    >
      <CollapsibleTrigger aria-label={title}>
        <span className="activityIcon" aria-hidden="true">
          {message.role === "reasoning" ? (
            <svg viewBox="0 0 24 24"><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2" /></svg>
          ) : (
            <svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" /></svg>
          )}
        </span>
        <span className="activityTitle">{title}</span>
        <span className="activityChevron" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
        </span>
        {status !== "running" ? <span className="activityStatus">{activityBadge(message)}</span> : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {message.summary && message.summary.trim() && message.summary.trim() !== message.text.trim() ? (
          <p className="activityNote">{message.summary}</p>
        ) : null}
        {message.details ? <ToolDetailsCard details={message.details} /> : null}
        {message.role === "reasoning" || message.role === "assistant" ? (
          <div className="messageBody">
            <SafeMarkdown text={body} />
          </div>
        ) : (
          <pre className="messageBody">{body}</pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolDetailsCard({ details }: { details: NonNullable<ChatMessage["details"]> }) {
  return (
    <div className="toolOutput" data-testid="toolDetails" data-kind={details.kind}>
      {details.code ? <pre className="toolCommand">{details.code}</pre> : null}
      <div className="toolInputCard">
        {details.fields.filter((field) => field.value).map((field) => (
          <div key={`${field.label}:${field.value}`} className="toolInputField">
            <span>{field.label}</span>
            <span>{field.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
