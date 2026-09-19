import * as vscode from "vscode"
import { randomUUID } from "node:crypto"
import { open } from "node:fs/promises"
import { extname, isAbsolute } from "node:path"
import { type AppServerMcpServer, type AppServerThreadSettings, type AppServerPromptAttachment, type AppServerFileDiff } from "@codem/app-server"
import { assertTrusted } from "./runtimeSession.ts"
import { changedFilePath, diffText, displayPath } from "./filePresentation.ts"
import { parseMcpConfiguration, type McpConfiguration } from "./mcpConfiguration.ts"

const configurationKey = "codem.mcp.v1"

export class NativeFeatures implements vscode.Disposable {
  private readonly documents = new Map<string, string>()
  private readonly registration: vscode.Disposable
  private readonly closed: vscode.Disposable
  constructor(private readonly secrets: vscode.SecretStorage) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider("codem-preview", {
      provideTextDocumentContent: (uri) => this.documents.get(uri.toString()) ?? "预览已关闭。",
    })
    this.closed = vscode.workspace.onDidCloseTextDocument((document) => { this.documents.delete(document.uri.toString()) })
  }
  dispose(): void { this.registration.dispose(); this.closed.dispose(); this.documents.clear() }

  async loadMcp(): Promise<readonly AppServerMcpServer[]> {
    const configuration = await this.configuration()
    return configuration.servers.filter((server) => configuration.enabled.includes(server.name))
  }
  private async configuration(): Promise<McpConfiguration> {
    const stored = await this.secrets.get(configurationKey)
    return stored === undefined ? { servers: [], enabled: [] } : parseMcpConfiguration(JSON.parse(stored))
  }

  async selectMcp(settings: AppServerThreadSettings): Promise<AppServerThreadSettings | null> {
    assertTrusted()
    const mcpServers = await this.manageMcp(settings.mcpServers)
    return mcpServers ? { ...settings, mcpServers } : null
  }

  private async manageMcp(current: readonly AppServerMcpServer[]): Promise<readonly AppServerMcpServer[] | null> {
    const configuration = await this.configuration()
    const action = await vscode.window.showQuickPick([
      { label: "启用 / 停用服务器", id: "toggle" },
      { label: "添加 stdio 服务器", id: "add" },
      { label: "移除服务器", id: "remove" },
    ], { title: "MCP · 本机加密保存，下一轮生效" })
    if (!action) return null
    if (action.id === "add") {
      const name = await vscode.window.showInputBox({ title: "MCP 名称", validateInput: (value) => !/^[a-zA-Z0-9_-]{1,80}$/.test(value) ? "使用 1–80 个字母、数字、下划线或连字符" : configuration.servers.some((server) => server.name === value) ? "名称已存在" : null })
      if (!name) return null
      const executable = await vscode.window.showOpenDialog({ title: "选择 MCP 可执行文件（例如 node 或 uvx）", canSelectMany: false, canSelectFiles: true, canSelectFolders: false })
      if (!executable?.[0] || executable[0].scheme !== "file") return null
      const args = await vscode.window.showInputBox({ title: "启动参数（JSON 字符串数组）", value: "[]", validateInput: (value) => { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? null : "请输入字符串数组" } catch { return "请输入合法 JSON" } } })
      if (args === undefined) return null
      const env = await vscode.window.showInputBox({ title: "环境变量（JSON 对象，加密保存）", value: "{}", password: true, validateInput: (value) => { try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every((item) => typeof item === "string") ? null : "请输入字符串值对象" } catch { return "请输入合法 JSON" } } })
      if (env === undefined) return null
      configuration.servers.push({ type: "stdio", name, command: executable[0].fsPath, args: JSON.parse(args) as string[], env: Object.entries(JSON.parse(env) as Record<string, string>).map(([name, value]) => ({ name, value })) })
      configuration.enabled = [...current.map((server) => server.name), name]
    } else if (action.id === "remove") {
      const server = await vscode.window.showQuickPick(configuration.servers.map((server) => server.name), { title: "移除 MCP 服务器及其保存的凭据" })
      if (!server) return null
      configuration.servers = configuration.servers.filter((item) => item.name !== server)
      configuration.enabled = current.filter((item) => item.name !== server).map((item) => item.name)
    } else {
      const selected = await vscode.window.showQuickPick(configuration.servers.map((server) => ({ label: server.name, picked: current.some((item) => item.name === server.name) })), { title: "选择本会话启用的 MCP 服务器", canPickMany: true, placeHolder: "取消勾选可停用；空列表可通过添加服务器配置" })
      if (!selected) return null
      configuration.enabled = selected.map((item) => item.label)
    }
    assertTrusted()
    const checked = parseMcpConfiguration(configuration)
    await this.secrets.store(configurationKey, JSON.stringify(checked))
    return checked.servers.filter((server) => checked.enabled.includes(server.name))
  }

  async pickAttachments(): Promise<readonly AppServerPromptAttachment[]> {
    const kind = await vscode.window.showQuickPick([{ label: "文件或图片", folder: false }, { label: "文件夹", folder: true }], { title: "添加附件" })
    if (!kind) return []
    const selected = await vscode.window.showOpenDialog({ title: "选择要发送给 CodeM 的附件", canSelectFiles: !kind.folder, canSelectFolders: kind.folder, canSelectMany: true })
    return (selected ?? []).filter((uri) => uri.scheme === "file").map((uri) => ({ kind: kind.folder ? "directory" : [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extname(uri.fsPath).toLowerCase()) ? "image" : "file", path: uri.fsPath }))
  }

  async showDiff(diff: AppServerFileDiff, cwd: string): Promise<void> {
    await this.preview(diffText(diff, displayPath(cwd, diff.path)), "diff", "文件差异")
  }
  async showChangedFile(diff: AppServerFileDiff, cwd: string): Promise<void> {
    assertTrusted()
    await vscode.window.showTextDocument(vscode.Uri.file(await changedFilePath(cwd, diff.path)), { preview: true })
  }
  async showLog(path: string): Promise<void> {
    assertTrusted()
    if (!isAbsolute(path)) throw new Error("Invalid log path")
    const file = await open(path, "r")
    let text: string
    try {
      const info = await file.stat()
      if (!info.isFile()) throw new Error("Invalid log file")
      const size = Math.min(info.size, 256 * 1024)
      const buffer = Buffer.alloc(size)
      const { bytesRead } = await file.read(buffer, 0, size, Math.max(0, info.size - size))
      text = `${info.size > size ? "仅显示最后 256 KiB\n" : ""}${buffer.subarray(0, bytesRead).toString("utf8")}`
    } finally { await file.close() }
    await this.preview(text, "log", "后台日志快照")
  }
  private async preview(text: string, extension: string, label: string): Promise<void> {
    const uri = vscode.Uri.from({ scheme: "codem-preview", path: `/${label}-${randomUUID()}.${extension}` })
    this.documents.set(uri.toString(), text)
    try { await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true }) }
    catch (error) { this.documents.delete(uri.toString()); throw error }
  }
}
