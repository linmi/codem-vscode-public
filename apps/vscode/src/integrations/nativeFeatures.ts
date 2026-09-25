import { compareDiff } from "../resources/diffComparison.ts"
import type { FileDiffContent } from "../resources/filePresentation.ts"
import type { ArtifactSource } from "../resources/artifacts.ts"
import * as vscode from "vscode"
import { randomUUID } from "node:crypto"
import { open } from "node:fs/promises"
import { extname, isAbsolute } from "node:path"
import { type AppServerMcpServer, type AppServerThreadSettings, type AppServerPromptAttachment } from "@codem/app-server"
import { assertTrusted } from "../connection/runtimeSession.ts"
import { changedFilePath, diffText, displayPath } from "../resources/filePresentation.ts"
import { parseMcpConfiguration, type McpConfiguration } from "../connection/mcpConfiguration.ts"

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

  async findFiles(cwd: string, query: string): Promise<readonly string[]> {
    assertTrusted()
    // Escape glob metacharacters: typed text is a literal filename query, not a glob.
    const literal = [...query.trim()].map(character => "*?[]{}".includes(character) ? `[${character}]` : character).join("")
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(cwd, `**/*${literal}*`), "**/{.git,node_modules,dist,history}/**", 50)
    assertTrusted()
    return files.filter(uri => uri.scheme === "file").map(uri => uri.fsPath)
  }

  async pickDirectories(): Promise<readonly string[]> {
    assertTrusted()
    const selected = await vscode.window.showOpenDialog({ title: "添加当前连接的工作目录（重载后重新选择）", canSelectFiles: false, canSelectFolders: true, canSelectMany: true })
    assertTrusted()
    return (selected ?? []).filter(uri => uri.scheme === "file").map(uri => uri.fsPath)
  }

  /** The folder picker for a local plugin; `plugins/pluginSource.ts` decides what the choice means. */
  async pickPluginFolder(): Promise<readonly vscode.Uri[] | undefined> {
    return vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "安装此文件夹中的插件", title: "选择含 .codem-plugin/plugin.json 的插件文件夹" })
  }

  async pickAttachments(kind: "file" | "directory"): Promise<readonly AppServerPromptAttachment[]> {
    const selected = await vscode.window.showOpenDialog({ title: "选择要发送给 CodeM 的附件", canSelectFiles: kind === "file", canSelectFolders: kind === "directory", canSelectMany: true })
    return (selected ?? []).filter((uri) => uri.scheme === "file").map((uri) => ({ kind: kind === "directory" ? "directory" : [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extname(uri.fsPath).toLowerCase()) ? "image" : "file", path: uri.fsPath }))
  }

  async showArtifact(source: ArtifactSource): Promise<void> {
    assertTrusted()
    if (source.kind === "chart") await this.preview(source.text, "json", "图表定义")
    else if (source.kind === "url") await vscode.env.openExternal(vscode.Uri.parse(source.url))
    else await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(source.path), { preview: true })
  }

  async showDiff(diff: FileDiffContent, cwd: string): Promise<void> {
    assertTrusted()
    let current: string | null = null
    if (diff.preview.kind === "complete" && diff.changeType !== "deleted") {
      try {
        const path = await changedFilePath(cwd, diff.path)
        const file = await open(path, "r")
        try {
          if ((await file.stat()).size <= 1024 * 1024) {
            const bytes = await file.readFile()
            current = bytes.includes(0) ? null : new TextDecoder("utf-8", { fatal: true }).decode(bytes)
          }
        } finally { await file.close() }
      } catch { current = null }
    }
    assertTrusted()
    const comparison = compareDiff(diff, current)
    const label = displayPath(cwd, diff.path)
    if (comparison.kind === "patch") {
      await this.preview(`${comparison.reason}\n\n${diffText(diff, label)}`, "diff", "文件差异")
      return
    }
    const id = randomUUID()
    const left = vscode.Uri.from({ scheme: "codem-preview", path: `/${id}/before/${label}` })
    const right = vscode.Uri.from({ scheme: "codem-preview", path: `/${id}/after/${label}` })
    this.documents.set(left.toString(), comparison.before); this.documents.set(right.toString(), comparison.after)
    try { await vscode.commands.executeCommand("vscode.diff", left, right, `${label} · 补丁重建的行内容对比`, { preview: true }) }
    catch (error) { this.documents.delete(left.toString()); this.documents.delete(right.toString()); throw error }
  }
  async showChangedFile(diff: FileDiffContent, cwd: string): Promise<void> {
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
