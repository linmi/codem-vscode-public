import { resolveBundledAppServerRuntime } from "@codem/app-server"
import { stageAppServerRuntime } from "@codem/app-server/build"

// 构建阶段执行，将当前平台的 Core / CLI 与许可证放入安装包。
export function stageRuntime(packageRoot: string, extensionRoot: string) {
  return stageAppServerRuntime({ packageRoot, extensionRoot })
}
// 安装后运行；绝对路径由应用平台提供。
export function resolveInstalledRuntime(extensionRoot: string) {
  return resolveBundledAppServerRuntime({ extensionRoot })
}
// 版本、平台、manifest 或 SHA-256 不匹配会抛错，不降级到其他 Core。
