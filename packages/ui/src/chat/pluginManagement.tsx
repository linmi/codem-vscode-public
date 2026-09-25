import { useState } from "react"
import { PackageIcon } from "lucide-react"
import { Button } from "../components/ui/button.tsx"
import { Input } from "../components/ui/input.tsx"
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog.tsx"
import { isPluginSpec, type ChatSnapshot } from "../contract.ts"

export function PluginManagement({ snapshot, post }: { snapshot: ChatSnapshot; post: (action: Record<string, unknown>) => void }) {
  const [spec, setSpec] = useState("")
  const [removing, setRemoving] = useState<string | null>(null)
  const view = snapshot.pluginManagement
  if (!view) return null
  const working = ["loading", "mutating", "reconciling"].includes(view.status)
  const disabled = snapshot.phase !== "ready" || snapshot.backgroundBusy || Boolean(snapshot.sessionTools.busy) || working
  const candidate = view.entries.find(entry => entry.id === removing)
  const validSpec = isPluginSpec(spec.trim())
  return <Dialog open={view.open} onOpenChange={open => { setRemoving(null); post({ type: open ? "showPluginManagement" : "closePluginManagement" }) }}>
    <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="管理插件与技能" title="管理插件与技能" disabled={disabled}><PackageIcon /></Button></DialogTrigger>
    <DialogContent className="pluginManagementDialog">
      <DialogHeader><DialogTitle>插件与技能</DialogTitle><DialogDescription>插件安装与启停影响当前用户的所有工作区。只安装你信任的插件。</DialogDescription></DialogHeader>
      <div className="pluginInstallActions"><Button variant="outline" disabled={disabled} onClick={() => post({ type: "installLocalPlugin" })}>从文件夹安装</Button><Button variant="ghost" disabled={disabled} onClick={() => post({ type: "showPluginManagement" })}>刷新清单</Button></div>
      <form onSubmit={event => { event.preventDefault(); if (!disabled && validSpec) post({ type: "installMarketplacePlugin", spec: spec.trim() }) }}>
        <Input aria-label="插件市场安装标识" placeholder="插件名@已配置的市场名" value={spec} maxLength={257} onChange={event => setSpec(event.target.value)} disabled={working} />
        <Button type="submit" disabled={disabled || !validSpec}>安装</Button>
      </form>
      {working ? <div role="status">{view.status === "loading" ? "正在读取插件与技能…" : view.status === "reconciling" ? "正在核对安装结果…" : "正在处理插件…"}{view.status !== "reconciling" ? <Button variant="ghost" onClick={() => post({ type: "cancelPluginOperation" })}>取消操作</Button> : null}</div> : null}
      {view.error ? <p role="alert">{view.error}</p> : null}
      {view.notice ? <p role="status">{view.notice}</p> : null}
      <div className="pluginManagementScroll">
        <h3>已安装插件</h3>
        {view.loaded && !view.entries.length ? <p>尚未安装插件。</p> : null}
        <ul className="pluginEntries">{view.entries.map(entry => <li key={entry.id}>
          <div><strong>{entry.name}</strong><span>{entry.version ?? "版本未提供"} · {entry.enabled ? "已启用" : "已禁用"}</span></div>
          <div><Button variant="outline" size="sm" disabled={disabled || !view.loaded} onClick={() => post({ type: "changePlugin", action: entry.enabled ? "disable" : "enable", id: entry.id })}>{entry.enabled ? "禁用" : "启用"}</Button><Button variant="ghost" size="sm" disabled={disabled || !view.loaded} onClick={() => setRemoving(entry.id)}>卸载</Button></div>
        </li>)}</ul>
        {candidate ? <section className="pluginRemoval" aria-label="确认卸载插件"><p>卸载 {candidate.name}？这会影响当前用户的其他工作区。本地插件源文件会保留。</p><Button variant="destructive" disabled={disabled} onClick={() => { post({ type: "changePlugin", action: "uninstall", id: candidate.id }); setRemoving(null) }}>确认卸载</Button><Button variant="ghost" onClick={() => setRemoving(null)}>取消</Button></section> : null}
        <h3>当前连接发现的技能</h3><p>只有出现在此目录中的技能可以在当前连接中选用。安装成功不代表技能已经可用。</p>
        {view.loaded && !view.skills.length && !working ? <p>当前连接未发现技能。</p> : null}
        <ul className="pluginSkills">{view.skills.map(skill => <li key={skill.name}><strong>{skill.name}</strong><span>{skill.description}</span></li>)}</ul>
      </div>
    </DialogContent>
  </Dialog>
}
