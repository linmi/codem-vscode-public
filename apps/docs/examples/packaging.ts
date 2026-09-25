import { createBundledAppServerRuntimeResolver, resolveBundledAppServerRuntime } from "@codem/app-server"
import { stageAppServerRuntime } from "@codem/app-server/build"

// 构建阶段执行，将当前平台的 Core / CLI 与许可证放入安装包。
export function stageRuntime(packageRoot: string, extensionRoot: string) {
  return stageAppServerRuntime({ packageRoot, extensionRoot })
}
// 安装后运行；绝对路径由应用平台提供。哈希以流式异步读取，不阻塞宿主事件循环。
export function resolveInstalledRuntime(extensionRoot: string) {
  return resolveBundledAppServerRuntime({ extensionRoot })
}
// 常驻宿主每次激活创建一个；每次调用仍比对清单，未变的可执行文件不重复读取。
export function createInstalledRuntimeResolver(extensionRoot: string) {
  return createBundledAppServerRuntimeResolver({ extensionRoot })
}
// 校验均返回 Promise；版本、平台、manifest 或 SHA-256 不匹配时拒绝，不降级到其他 Core。
