import type { AppServerHost } from "@codem/app-server"

export async function readCatalogs(host: AppServerHost, cwd: string) {
  // prepareConnection 完成后，两个目录读取彼此独立。
  await host.prepareConnection(cwd)
  const [models, skills] = await Promise.all([
    host.listModels(cwd),
    host.listSkills(cwd),
  ])
  return { models, skills }
}
// 按连接保存目录；空间 / 连接切换或变更通知后失效。
// 模型和强度选项以返回目录为准，不硬编码其他产品的名称。
