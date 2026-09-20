import * as vscode from "vscode"
import { assertCommitDiff, commitPrompt, commitMessage } from "./commitMessage.ts"
import { assertTrusted } from "../connection/runtimeSession.ts"
import type { ChatController } from "../chat/chatController.ts"

// Narrow structural contract of the built-in vscode.git API v1 (VS Code 1.105.1).
interface Repository {
  rootUri: vscode.Uri
  inputBox: { value: string }
  state: { HEAD: { commit?: string } | undefined }
  diff(cached?: boolean): Promise<string>
  log(options: { maxEntries: number; maxParents: number; range: string }): Promise<{ message: string }[]>
}
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
          const reading = performance.now()
          const head = repo.state.HEAD?.commit
          const diff = await repo.diff(true)
          assertCommitDiff(diff)
          abort.signal.throwIfAborted()
          // An unborn repository legitimately has no examples. Other history failures are errors.
          const recent = head ? await repo.log({ maxEntries: 8, maxParents: 1, range: head }) : []
          abort.signal.throwIfAborted(); assertTrusted()
          log(`Commit context: ${Math.round(performance.now() - reading)}ms`)
          const generating = performance.now()
          const response = await chat.generateText(commitPrompt(diff, recent.map(commit => commit.message), vscode.env.language), abort.signal, scope)
          log(`Commit generation: ${Math.round(performance.now() - generating)}ms`)
          abort.signal.throwIfAborted(); assertTrusted()
          // Generation may legitimately create the first thread. Guard switches during verification.
          const generatedContext = chat.contextKey()
          const message = commitMessage(response)
          if (!git.getAPI(1).repositories.includes(repo) || !vscode.workspace.getWorkspaceFolder(repo.rootUri)) throw new Error("仓库已关闭，未写入提交说明。")
          if (repo.inputBox.value !== previous) throw new Error("提交说明已被编辑，生成结果未覆盖你的内容。")
          const current = await repo.diff(true)
          abort.signal.throwIfAborted(); assertTrusted()
          if (current !== diff || repo.inputBox.value !== previous || repo.state.HEAD?.commit !== head || chat.contextKey() !== generatedContext) throw new Error("暂存内容、提交说明或会话上下文已变化，请重新生成。")
          repo.inputBox.value = message
        } finally { subscription.dispose() }
      })
    } catch (error) {
      if (!abort.signal.aborted) void vscode.window.showErrorMessage(error instanceof Error ? error.message : "提交说明生成失败，请重试。")
    } finally { log(`Commit message: ${Math.round(performance.now() - started)}ms`); if (active === abort) active = null }
  })
  return vscode.Disposable.from(command, { dispose() { active?.abort() } })
}
