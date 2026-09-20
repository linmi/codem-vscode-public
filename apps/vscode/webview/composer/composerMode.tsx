import { createRoot } from "react-dom/client"
import { MessageSquarePlusIcon, TerminalIcon, XIcon } from "lucide-react"
import type { ChatSnapshot, ViewAction } from "../../src/shared/messages.ts"
import { inputUnavailable, type ComposerMode } from "../../src/shared/sessionCommands.ts"
import { Button } from "../components/ui/button.tsx"
export const modeLabels = { message: "对话", askSideQuestion: "旁路提问", steer: "补充指令", shellCommand: "Shell 命令" }
function ComposerInputMode({ mode, state, leave, post }: { mode: ComposerMode; state: ChatSnapshot; leave: () => void; post: (action: ViewAction) => void }) {
  const side = state.sessionTools.sideQuestion
  return <>
    {mode !== "message" && <div className="composerModeBar"><span>{mode === "shellCommand" ? <TerminalIcon aria-hidden="true" /> : <MessageSquarePlusIcon aria-hidden="true" />}{modeLabels[mode]}</span><Button type="button" variant="ghost" size="sm" onClick={leave} aria-label="返回普通对话"><XIcon aria-hidden="true" />返回对话</Button><p>{inputUnavailable(mode, state) ?? (mode === "steer" ? "补充当前任务的执行方向。" : mode === "askSideQuestion" ? "单独提问，回答显示在这里。" : "发送前会展示命令并请求确认。")}{state.attachments.length ? ` ${state.attachments.length} 个附件保留给普通消息。` : ""}</p></div>}
    {mode === "askSideQuestion" && side && <section className="composerSideAnswer" aria-label="旁路问答"><strong>{side.question}</strong><pre>{side.answer}</pre><div className="sessionToolActions"><span role="status">{{ starting: "正在提交", running: "正在回答", stopping: "正在取消", completed: "已完成", interrupted: "已取消", failed: "失败", incomplete: "连接中断，未完成" }[side.status]}</span>{["running", "stopping"].includes(side.status) && <Button type="button" variant="outline" size="sm" disabled={side.status === "stopping"} onClick={() => post({ type: "cancelSideQuestion" })}>取消旁路提问</Button>}</div></section>}
  </>
}
export function createComposerMode(host: HTMLElement, leave: () => void, post: (action: ViewAction) => void) {
  const root = createRoot(host)
  return (mode: ComposerMode, state: ChatSnapshot) => root.render(<ComposerInputMode mode={mode} state={state} leave={leave} post={post} />)
}
