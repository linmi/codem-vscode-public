import { useState } from "react"
import { ListOrderedIcon, PencilIcon, SendHorizontalIcon, XIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Textarea } from "../components/ui/textarea.tsx"
import type { ChatSnapshot, MessageQueueView } from "../contract.ts"

/**
 * 运行中排队的消息：宿主持有队列并在本轮完成后依次发送，这里只展示并发出编辑、移除和继续。
 * 编辑中的文字只属于本组件；条目被宿主发出或移除后，编辑框随之消失。
 */
export function QueuedMessages({ queue, phase, post }: { queue: MessageQueueView | null; phase: ChatSnapshot["phase"]; post: (action: Record<string, unknown>) => void }) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  if (!queue || queue.items.length === 0) return null
  const active = editing && queue.items.some((item) => item.id === editing.id) ? editing : null
  const save = () => {
    if (!active || !active.text.trim()) return
    const current = queue.items.find((item) => item.id === active.id)
    if (current && current.text !== active.text) post({ type: "editQueuedMessage", id: active.id, text: active.text })
    setEditing(null)
  }
  return (
    <section className="composerQueue" aria-label="排队消息" data-testid="messageQueue" data-paused={queue.paused ? "true" : "false"}>
      <div className="composerQueueHeader">
        <span>
          <ListOrderedIcon aria-hidden="true" />
          {`排队中 ${queue.items.length} 条`}
        </span>
        {queue.paused ? (
          <Button type="button" variant="ghost" size="sm" disabled={phase !== "ready"} onClick={() => post({ type: "resumeQueue" })}>
            <SendHorizontalIcon aria-hidden="true" />
            继续发送
          </Button>
        ) : null}
        <p role="status">{queue.paused ? "上一轮已停止或失败，排队消息不会自动发送。" : "本轮完成后按顺序发送。"}</p>
      </div>
      <ol>
        {queue.items.map((item, index) => (
          <li key={item.id}>
            {active?.id === item.id ? (
              <div className="composerQueueEdit">
                <Textarea
                  aria-label={`编辑第 ${index + 1} 条排队消息`}
                  value={active.text}
                  maxLength={32000}
                  autoFocus
                  onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault()
                      event.stopPropagation()
                      setEditing(null)
                    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      save()
                    }
                  }}
                />
                <div className="sessionToolActions">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>取消</Button>
                  <Button type="button" variant="outline" size="sm" disabled={!active.text.trim()} onClick={save}>保存</Button>
                </div>
              </div>
            ) : (
              <>
                <span className="composerQueueText">{item.text}</span>
                <Button type="button" variant="toolbar" size="footerIcon" aria-label={`编辑第 ${index + 1} 条排队消息`} title="编辑" onClick={() => setEditing({ id: item.id, text: item.text })}>
                  <PencilIcon aria-hidden="true" />
                </Button>
                <Button type="button" variant="toolbar" size="footerIcon" aria-label={`移除第 ${index + 1} 条排队消息`} title="移除" onClick={() => post({ type: "removeQueuedMessage", id: item.id })}>
                  <XIcon aria-hidden="true" />
                </Button>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
