import type { AppServerHost } from "@codem/app-server"
import type { CatalogKind, CatalogRow } from "../shared/capabilityTypes.ts"

type CatalogHost = Pick<AppServerHost, "readEnvironmentInfo" | "readConfigSnapshot" | "listHooks" | "listPlugins" | "listPermissionProfiles" | "readCoreSpaceSnapshot" | "readModelProviderCapabilities" | "listLoadedThreadIds" | "listLiveThreadTurns" | "listLiveThreadItems">
/** Copy approved fields only; never serialize a Core object into the Webview. */
export async function projectCatalog(host: CatalogHost, cwd: string, threadId: string | null, kind: Exclude<CatalogKind, "skills">): Promise<readonly CatalogRow[]> {
  switch (kind) {
    case "environment": {
      const info = await host.readEnvironmentInfo(cwd)
      return [{ label: info.agentName, detail: info.agentVersion }, { label: "运行平台", detail: `${info.os} · ${info.arch}` }]
    }
    case "config": {
      const info = await host.readConfigSnapshot(cwd)
      return [{ label: "配置归属", detail: info.writeOwner }, { label: "App Server 写入", detail: info.writable ? "服务声明可写；本客户端提供只读检查" : "只读" }, ...Object.entries(info.config).map(([label, value]) => ({ label, detail: value === null ? "空值或已隐藏" : Array.isArray(value) ? `数组 · ${value.length} 项（值不下发）` : `${typeof value}（值不下发）` }))]
    }
    case "hooks": {
      const info = await host.listHooks(cwd)
      return Object.entries(info.hooks).map(([label, handlers]) => ({ label, detail: `${handlers.length} 个处理器；命令保留在 Host` }))
    }
    case "plugins": {
      const info = await host.listPlugins(cwd)
      return [...Object.keys(info.installed).map(label => ({ label, detail: "已安装" })), ...Object.keys(info.marketplaces).map(label => ({ label, detail: "插件市场" }))]
    }
    case "permissions": return (await host.listPermissionProfiles(cwd)).map(profile => ({ label: profile.name, detail: `${profile.description} · ${profile.settableAtRuntime ? "可在权限菜单切换" : "不可运行时切换"}` }))
    case "spaces": {
      const info = await host.readCoreSpaceSnapshot(cwd)
      return info.spaces.map(space => ({ label: space.displayName, detail: space.projectKey === info.current?.projectKey ? "Core 当前空间" : "Core 空间快照；切换仍通过空间菜单" }))
    }
    case "provider": {
      const info = await host.readModelProviderCapabilities(cwd)
      return [{ label: "Core", detail: info.version }, ...Object.entries(info.askUser).map(([label, value]) => ({ label: `问答 · ${label}`, detail: value ? "支持" : "不支持" })), ...Object.entries(info.custom).map(([label, value]) => ({ label: `模型 · ${label}`, detail: value ? "支持" : "不支持" }))]
    }
    case "live": {
      const loaded = await host.listLoadedThreadIds(cwd)
      const rows: CatalogRow[] = [{ label: "已加载会话", detail: `${loaded.threadIds.length} 个；当前会话${threadId && loaded.threadIds.includes(threadId) ? "已加载" : "未加载"}` }]
      if (!threadId) return rows
      const [turns, items] = await Promise.all([host.listLiveThreadTurns(cwd, threadId), host.listLiveThreadItems(cwd, threadId)])
      rows.push({ label: "实时轮次", detail: `总计 ${turns.total}；本页 ${turns.entries.length}${turns.nextCursor ? "（还有后续页）" : ""}` }, ...turns.entries.map((turn, index) => ({ label: `轮次 ${index + 1}`, detail: `${turn.status ?? "状态未知"} · ${turn.startedAt ?? "时间未知"}` })), { label: "实时项目", detail: `总计 ${items.total}；本页 ${items.entries.length}${items.nextCursor ? "（还有后续页）" : ""}；持久消息仍以 JSONL 为准` }, ...items.entries.map((item, index) => ({ label: `项目 ${index + 1} · ${item.type}`, detail: item.status })))
      return rows
    }
  }
}
