import { useId } from "react"
import { InfoIcon, KeyboardIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.tsx"
import type { ChatPhase, ChatSnapshot } from "../contract.ts"

const labels: Record<string, string> = { idle: "空闲", running: "运行中", completed: "已完成", in_progress: "进行中", pending: "待执行", failed: "失败", success: "成功", allow: "允许", deny: "拒绝", skipped: "已跳过", interrupted: "已中断" }
const phaseLabels: Record<ChatPhase, string> = {
  disconnected: "未连接", connecting: "连接中", configuring: "配置中", ready: "就绪", loadingHistory: "读取历史",
  sending: "发送中", running: "运行中", stopping: "停止中", sideQuestion: "旁路提问中", failed: "失败", closing: "关闭中",
}
const format = (value: number | null) => value === null ? "未知" : value.toLocaleString("zh-CN")

/** 对照 VS Code capabilityStatus：右下角运行详情，无数据也能打开。 */
export function RuntimeDetails({ snapshot }: { snapshot: ChatSnapshot }) {
  const titleId = useId()
  const state = snapshot.capabilities
  const status = state.threadStatus ? labels[state.threadStatus] ?? state.threadStatus : "尚未开始"
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <Button id="runtimeDetails" data-thread-id={snapshot.threadId ?? ""} variant="toolbar" size="footerIcon" title="运行详情与快捷键" aria-label="运行详情与快捷键">
          <InfoIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="runtimeDetailsPopover" side="top" align="end" sideOffset={8} collisionPadding={12} aria-labelledby={titleId}>
        <header className="runtimeDetailsHeading"><h2 id={titleId}>运行详情</h2></header>
        <div className="runtimeDetailsBody">
          <section className="runtimeSection" aria-label="会话状态">
            <div className="runtimeSectionHeading"><h3>会话状态</h3><span className="runtimeBadge">{phaseLabels[snapshot.phase]}</span></div>
            <dl className="runtimeRows"><div><dt>运行状态</dt><dd>{status}</dd></div></dl>
            {state.activity ? <p className="runtimeActivity" role="status">{state.activity}</p> : null}
          </section>
          <section className="runtimeSection" aria-label="Token 用量">
            <h3>Token 用量</h3>
            {state.usage ? (
              <dl className="runtimeMetrics">
                {([["输入", state.usage.input], ["输出", state.usage.output], ["缓存读取", state.usage.cacheRead], ["缓存创建", state.usage.cacheWrite]] as const).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{format(value)}</dd></div>
                ))}
              </dl>
            ) : <p className="runtimeEmpty">暂无用量数据</p>}
          </section>
          {state.changes.length > 0 ? (
            <section className="runtimeSection"><h3>文件修改</h3>
              <ul className="runtimeList" aria-label="轮次修改汇总">{state.changes.map((file, index) => (
                <li key={index}><span className="runtimeFile">{file.label}</span><span className="runtimeDelta"><span className="diffAdded">+{file.added}</span><span className="diffRemoved">−{file.removed}</span></span></li>
              ))}</ul>
            </section>
          ) : null}
          {state.guards.length > 0 ? (
            <section className="runtimeSection"><h3>工具输出保护</h3>
              <ul className="runtimeRecords">{state.guards.map((guard) => (
                <li key={guard.id}><div><strong>{guard.tool}</strong><span className="runtimeBadge">{labels[guard.status] ?? guard.status}</span></div><p>返回 {format(guard.returnedBytes)} B / 原始 {format(guard.rawBytes)} B</p>{guard.capped ? <p>已限制输出</p> : null}</li>
              ))}</ul>
            </section>
          ) : null}
          {state.hooks.length > 0 ? (
            <section className="runtimeSection"><h3>Hooks</h3>
              <ul className="runtimeRecords">{state.hooks.map((hook) => (
                <li key={hook.id}><div><strong>{hook.event}</strong><span className="runtimeBadge">{labels[hook.outcome] ?? hook.outcome}</span></div><p>{hook.tool ? <span>{hook.tool} · </span> : null}{format(hook.elapsedMs)} ms</p></li>
              ))}</ul>
            </section>
          ) : null}
          <section className="runtimeSection" aria-label="快捷键">
            <h3 className="runtimeKeyboardHeading"><KeyboardIcon aria-hidden="true" />快捷键</h3>
            <dl className="runtimeRows runtimeShortcuts">
              <div><dt>发送消息</dt><dd><kbd>{snapshot.sendKey === "enter" ? "Enter" : "Ctrl / Cmd + Enter"}</kbd></dd></div>
              <div><dt>换行</dt><dd><kbd>{snapshot.sendKey === "enter" ? "Shift + Enter" : "Enter"}</kbd></dd></div>
            </dl>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  )
}
