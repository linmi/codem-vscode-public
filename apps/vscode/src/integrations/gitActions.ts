import * as vscode from "vscode"
import { commitPrompt, generatedText } from "./editorGeneration.ts"
import { assertTrusted } from "../connection/runtimeSession.ts"
import type { ChatController } from "../chat/chatController.ts"

// Narrow structural contract of the built-in vscode.git API v1 (VS Code 1.105.1).
interface Repository { rootUri: vscode.Uri; inputBox: { value: string }; diff(cached?: boolean): Promise<string> }
interface GitApi { repositories: Repository[] }
interface GitExtension { enabled: boolean; getAPI(version: 1): GitApi }

export function registerGitActions(chat: ChatController, log: (message: string) => void): vscode.Disposable {
  let active: AbortController | null = null
  const command = vscode.commands.registerCommand("codem.generateCommitMessage", async (source?: { rootUri?: vscode.Uri }) => {
    if (active) { void vscode.window.showInformationMessage("正在生成提交说明，可在进度通知中取消。"); return }
    const abort = new AbortController(); active = abort
    const scope = chat.contextKey()
    const started = performance.now()
    try {
      assertTrusted()
      const extension = vscode.extensions.getExtension<GitExtension>("vscode.git")
      if (!extension) throw new Error("请启用 VS Code 内置 Git 扩展。")
      const git = extension.isActive ? extension.exports : await extension.activate()
      if (!git.enabled) throw new Error("VS Code Git 功能已禁用。")
      const repositories = git.getAPI(1).repositories.filter(repo => vscode.workspace.getWorkspaceFolder(repo.rootUri))
      const target = source?.rootUri?.toString()
      let repository = target ? repositories.find(repo => repo.rootUri.toString() === target) : undefined
      if (target && !repository) throw new Error("所选 Git 仓库已关闭。")
      if (!repository) repository = repositories.length === 1 ? repositories[0] : (await vscode.window.showQuickPick(repositories.map(repo => ({ label: vscode.workspace.asRelativePath(repo.rootUri, true), repository: repo })), { title: "选择生成提交说明的仓库" }))?.repository
      if (!repository) { if (!repositories.length) throw new Error("当前工作区没有 Git 仓库。"); return }
      const repo = repository
      await chat.assertContextDirectory(repo.rootUri.fsPath)
      const previous = repo.inputBox.value
      if (previous.trim() && await vscode.window.showWarningMessage("生成成功后替换当前提交说明？", { modal: true }, "替换") !== "替换") return
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "CodeM 正在生成提交说明", cancellable: true }, async (_progress, token) => {
        const subscription = token.onCancellationRequested(() => abort.abort())
        try {
          assertTrusted(); abort.signal.throwIfAborted()
          const diff = await repo.diff(true)
          const response = await chat.generateText(commitPrompt(diff), abort.signal, scope)
          abort.signal.throwIfAborted(); assertTrusted()
          const message = generatedText(response, "message")
          if (!git.getAPI(1).repositories.includes(repo) || !vscode.workspace.getWorkspaceFolder(repo.rootUri)) throw new Error("仓库已关闭，未写入提交说明。")
          if (repo.inputBox.value !== previous) throw new Error("提交说明已被编辑，生成结果未覆盖你的内容。")
          const current = await repo.diff(true)
          abort.signal.throwIfAborted(); assertTrusted()
          if (current !== diff || repo.inputBox.value !== previous) throw new Error("暂存内容或提交说明已变化，请重新生成。")
          repo.inputBox.value = message
        } finally { subscription.dispose() }
      })
    } catch (error) {
      if (!abort.signal.aborted) void vscode.window.showErrorMessage(error instanceof Error ? error.message : "提交说明生成失败，请重试。")
    } finally { log(`Commit message: ${Math.round(performance.now() - started)}ms`); if (active === abort) active = null }
  })
  return vscode.Disposable.from(command, { dispose() { active?.abort() } })
}
