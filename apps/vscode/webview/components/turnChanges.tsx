import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { FileDiffIcon } from "lucide-react"
import type { ViewAction } from "../../src/messages.ts"
import type { TurnChanges } from "../../src/turnChanges.ts"
import { Button } from "./button.tsx"

function TurnChangeList({ group, post }: { group: TurnChanges; post: (action: ViewAction) => void }) {
  const repeated = new Set(group.files.map(file => file.label)).size < group.files.length
  return <section className="turnChanges" aria-label="本轮文件变更" data-turn-id={group.turnId}>
    <div className="turnChangesHeading"><FileDiffIcon aria-hidden="true" /><strong>本轮文件变更</strong><span>{group.files.length} 处</span></div>
    {repeated && <p className="turnChangesHint">同一文件的多次修改分段展示，增删数为各段统计。</p>}
    <ul>{group.files.map(file => <li key={file.id}>
      <div className="turnChangeFile"><span>{file.label}</span><span className="turnChangeStats"><span className="diffAdded">+{file.added}</span><span className="diffRemoved">−{file.removed}</span></span></div>
      <div className="turnChangeActions">{file.preview !== "complete" && <span>{{ partial: "部分差异", "raw-partial": "部分差异", binary: "二进制", omitted: "无预览内容" }[file.preview]}</span>}{!file.available && <span>当前不可用</span>}<Button variant="ghost" size="sm" disabled={!file.available} aria-label={`查看差异 ${file.label}`} onClick={() => post({ type: "openDiff", id: file.id })}>查看差异</Button></div>
    </li>)}</ul>
  </section>
}

export function createTurnChanges(host: HTMLElement, post: (action: ViewAction) => void) {
  const root = createRoot(host)
  let previous = ""
  return { update: (group: TurnChanges) => {
    const key = JSON.stringify(group)
    if (key === previous) return
    previous = key
    // The transcript measures scroll anchors immediately after placing these roots.
    flushSync(() => root.render(<TurnChangeList group={group} post={post} />))
  }, dispose: () => root.unmount() }
}
