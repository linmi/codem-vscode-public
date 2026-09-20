import { createRoot } from "react-dom/client"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.tsx"
import { Button } from "./button.tsx"
import type { CapabilityState } from "../../src/capabilityTypes.ts"

function CapabilityStatus({ state }: { state: CapabilityState }) {
  const visible = state.activity || state.usage || state.plan.length || state.hooks.length || state.guards.length || state.changes.length || state.threadStatus
  if (!visible) return null
  return <Collapsible className="capabilityStatus">
    <CollapsibleTrigger asChild><Button variant="ghost" size="sm">运行详情{state.plan.length ? ` · ${state.plan.filter(step => step.status === "completed").length}/${state.plan.length} 步` : ""}</Button></CollapsibleTrigger>
    <CollapsibleContent className="capabilityStatusContent">
      {state.activity && <p role="status">{state.activity}</p>}
      {state.threadStatus && <p>会话状态：{state.threadStatus}</p>}
      {state.usage && <p>Token · 输入 {state.usage.input ?? "未知"} · 输出 {state.usage.output ?? "未知"} · 缓存读取 {state.usage.cacheRead ?? "未知"} · 缓存创建 {state.usage.cacheWrite ?? "未知"}</p>}
      {state.plan.length > 0 && <ol aria-label="执行计划">{state.plan.map((step, i) => <li key={i}><span>{step.status === "completed" ? "✓" : step.status === "in_progress" ? "进行中" : step.status}</span> {step.content}</li>)}</ol>}
      {state.changes.length > 0 && <ul aria-label="轮次修改汇总">{state.changes.map((file, i) => <li key={i}>{file.label} +{file.added} −{file.removed}</li>)}</ul>}
      {state.guards.map(guard => <p key={guard.id}>工具输出保护 · {guard.tool} · {guard.status} · 返回 {guard.returnedBytes} B / 原始 {guard.rawBytes ?? "未知"} B{guard.capped ? " · 已限制输出" : ""}</p>)}
      {state.hooks.map(hook => <p key={hook.id}>Hook · {hook.event}{hook.tool ? ` · ${hook.tool}` : ""} · {hook.outcome} · {hook.elapsedMs} ms</p>)}
    </CollapsibleContent>
  </Collapsible>
}

export function createCapabilityStatus(host: HTMLElement) {
  const root = createRoot(host)
  let previous = ""
  return (state: CapabilityState) => {
    const key = JSON.stringify(state)
    if (previous === key) return
    previous = key
    root.render(<CapabilityStatus state={state} />)
  }
}
