import type { AppServerHost } from "@codem/app-server"
import type { CatalogKind, CatalogRow } from "../shared/capabilityTypes.ts"

type CatalogHost = Pick<AppServerHost, "readEnvironmentInfo" | "readConfigSnapshot" | "listHooks" | "listPlugins" | "listPermissionProfiles" | "readCoreSpaceSnapshot" | "readModelProviderCapabilities">
/** Copy approved fields only; never serialize a Core object into the Webview. */
export async function projectCatalog(host: CatalogHost, cwd: string, kind: Exclude<CatalogKind, "skills" | "live">): Promise<readonly CatalogRow[]> {
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
  }
}
