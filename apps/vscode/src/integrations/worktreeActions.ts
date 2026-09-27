import * as vscode from "vscode"
import { execFile } from "node:child_process"
import { realpath } from "node:fs/promises"
import { basename, sep } from "node:path"
import { hostedRepository, pullRequestUrl } from "./pullRequest.ts"
import { asOpenedPath, gitErrorMessage, suggestedBranch, Worktrees, type GitRunner, type WorktreeEntry } from "./worktree.ts"
import { assertTrusted } from "../connection/runtimeSession.ts"

// Narrow structural contract of the built-in vscode.git API v1 (VS Code 1.105.1).
interface Branch { name?: string; commit?: string; upstream?: { remote: string; name: string }; ahead?: number }
interface Repository {
  rootUri: vscode.Uri
  state: { HEAD: Branch | undefined; remotes: readonly { name: string; fetchUrl?: string; pushUrl?: string }[] }
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>
}
interface GitApi { git: { path: string }; repositories: Repository[] }
interface GitExtension { enabled: boolean; getAPI(version: 1): GitApi }

function runner(gitPath: string): GitRunner {
  return (args, cwd, signal) => new Promise((resolve, reject) => {
    execFile(gitPath, [...args], { cwd, signal, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(gitErrorMessage(String(stderr)) ?? error.message))
      else resolve(String(stdout))
    })
  })
}

async function gitApi(): Promise<GitApi> {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git")
  if (!extension) throw new Error("请启用 VS Code 内置 Git 扩展。")
  const git = extension.isActive ? extension.exports : await extension.activate()
  if (!git.enabled) throw new Error("VS Code Git 功能已禁用。")
  return git.getAPI(1)
}

async function pickRepository(api: GitApi, title: string): Promise<Repository | undefined> {
  const repositories = api.repositories.filter(repo => vscode.workspace.getWorkspaceFolder(repo.rootUri))
  if (!repositories.length) throw new Error("当前工作区没有 Git 仓库。")
  if (repositories.length === 1) return repositories[0]
  return (await vscode.window.showQuickPick(repositories.map(repo => ({ label: vscode.workspace.asRelativePath(repo.rootUri, true), repository: repo })), { title }))?.repository
}

/**
 * Opening always uses a new window: each window owns one workspace, one Core connection and its own sessions. The
 * path is respelled like this window's folder so a window already showing it is focused rather than duplicated.
 */
async function openWindow(path: string, repository: Repository): Promise<void> {
  const opened = vscode.workspace.getWorkspaceFolder(repository.rootUri)?.uri.fsPath ?? repository.rootUri.fsPath
  const target = asOpenedPath(path, opened, await realpath(opened).catch(() => opened), sep)
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(target), { forceNewWindow: true })
}

function describe(entry: WorktreeEntry): string {
  if (entry.branch) return entry.branch
  return entry.detached ? `分离头指针 ${entry.head?.slice(0, 8) ?? ""}` : basename(entry.path)
}

/**
 * Worktree commands. They read and write only git's own worktree records, keep nothing in memory between calls,
 * and hand the new folder to a new VS Code window, where CodeM connects to it like any other workspace.
 */
export function registerWorktreeActions(log: (message: string) => void): vscode.Disposable {
  let busy = false
  const guarded = (name: string, action: () => Promise<void>) => vscode.commands.registerCommand(name, async () => {
    if (busy) { void vscode.window.showInformationMessage("另一个 worktree 操作仍在进行。"); return }
    busy = true
    try { assertTrusted(); await action() }
    catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "worktree 操作失败。") }
    finally { busy = false }
  })

  const create = async () => {
    const api = await gitApi()
    const repository = await pickRepository(api, "选择要新建 worktree 的仓库")
    if (!repository) return
    const root = repository.rootUri.fsPath
    const worktrees = new Worktrees(runner(api.git.path))
    const head = repository.state.HEAD
    const base = head?.name ?? head?.commit
    if (!base) throw new Error("当前仓库还没有提交，无法新建 worktree。")
    const input = await vscode.window.showInputBox({
      title: "新建 worktree",
      prompt: `新分支从 ${head?.name ?? base.slice(0, 8)} 创建；填写已有且未检出的分支名则直接检出该分支。`,
      placeHolder: "例如：fix/login-timeout",
      ignoreFocusOut: true,
      validateInput: value => value.trim() && !suggestedBranch(value) ? "分支名无效。" : null,
    })
    if (input === undefined || !input.trim()) return
    const branch = suggestedBranch(input)
    const started = performance.now()
    // Not cancellable: stopping git midway can leave a half-created worktree directory behind.
    const path = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在创建 worktree ${branch}` }, () => worktrees.create(root, branch, base))
    log(`Worktree created: ${Math.round(performance.now() - started)}ms`)
    // Not awaited: an unanswered toast must not hold the one-operation guard for every later command.
    void vscode.window.showInformationMessage(`已创建 worktree ${branch}：${path}`, "在新窗口打开").then(choice => {
      if (choice === "在新窗口打开") return openWindow(path, repository)
    }).then(undefined, (error: unknown) => { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法打开 worktree。") })
  }

  const open = async () => {
    const api = await gitApi()
    const repository = await pickRepository(api, "选择仓库")
    if (!repository) return
    const worktrees = new Worktrees(runner(api.git.path))
    const current = await realpath(repository.rootUri.fsPath)
    const entries = (await worktrees.list(repository.rootUri.fsPath)).filter(entry => !entry.bare && !entry.prunable)
    const others: (vscode.QuickPickItem & { path: string })[] = []
    for (const [index, entry] of entries.entries()) {
      const resolved = await realpath(entry.path).catch(() => entry.path)
      if (resolved === current) continue
      others.push({ label: describe(entry), description: index === 0 ? "主工作区" : entry.locked ? "已锁定" : undefined, detail: entry.path, path: entry.path })
    }
    if (!others.length) {
      void vscode.window.showInformationMessage("这个仓库还没有其他 worktree，可以使用「CodeM: 新建 worktree」创建。")
      return
    }
    const picked = await vscode.window.showQuickPick(others, { title: "在新窗口打开 worktree", matchOnDetail: true })
    if (picked) await openWindow(picked.path, repository)
  }

  /** Only another window may remove a worktree: this window's Core, terminals and watchers all live inside it. */
  const close = async () => {
    const api = await gitApi()
    const repository = await pickRepository(api, "选择仓库")
    if (!repository) return
    const root = repository.rootUri.fsPath
    const worktrees = new Worktrees(runner(api.git.path))
    const entries = await worktrees.list(root)
    const main = entries[0]
    if (!main) throw new Error("无法读取 worktree 列表。")
    if (await realpath(main.path).catch(() => main.path) !== await realpath(root)) {
      // Not awaited, like every other toast that only offers a follow-up.
      void vscode.window.showInformationMessage("当前窗口就在这个 worktree 中，请在主工作区窗口里删除它。", "打开主工作区").then(choice => {
        if (choice === "打开主工作区") return openWindow(main.path, repository)
      }).then(undefined, (error: unknown) => { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法打开主工作区。") })
      return
    }
    const linked = entries.slice(1).filter(entry => !entry.bare && !entry.prunable)
    if (!linked.length) { void vscode.window.showInformationMessage("这个仓库没有可删除的 worktree。"); return }
    const picked = await vscode.window.showQuickPick(linked.map(entry => ({ label: describe(entry), description: entry.locked ? "已锁定" : undefined, detail: entry.path, entry })), { title: "删除 worktree", matchOnDetail: true })
    if (!picked) return
    const entry = picked.entry
    const changes = await worktrees.changes(entry.path)
    const withBranch = entry.branch ? `删除 worktree 和分支` : undefined
    const choice = await vscode.window.showWarningMessage(`删除 worktree ${describe(entry)}？`, {
      modal: true,
      detail: `${entry.path}\n\n${changes.length ? `有 ${changes.length} 处未提交或未跟踪的修改，删除后无法恢复。` : "没有未提交的修改。"}${entry.branch ? `\n分支 ${entry.branch} 默认保留；选择同时删除时，未合并的分支会保留。` : ""}\n请先关闭打开该 worktree 的窗口。`,
    }, "删除 worktree", ...(withBranch ? [withBranch] : []))
    if (!choice) return
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在删除 worktree ${describe(entry)}` }, () =>
      worktrees.remove(root, entry, { force: changes.length > 0, deleteBranch: choice === withBranch }))
    log(`Worktree removed; branch deleted: ${result.branchDeleted}`)
    if (result.branchError) void vscode.window.showWarningMessage(`worktree 已删除；分支 ${entry.branch} 未删除：${result.branchError}`)
    else void vscode.window.showInformationMessage(result.branchDeleted ? `已删除 worktree 和分支 ${entry.branch}。` : `已删除 worktree ${describe(entry)}。`)
  }

  /** Opens the host's new-PR page for the current branch; pushing first is the person's explicit choice. */
  const pullRequest = async () => {
    const api = await gitApi()
    const repository = await pickRepository(api, "选择仓库")
    if (!repository) return
    const git = runner(api.git.path)
    const root = repository.rootUri.fsPath
    const head = repository.state.HEAD
    const branch = head?.name
    if (!branch) throw new Error("当前不在任何分支上，请先检出分支。")
    const remoteName = head.upstream?.remote ?? (repository.state.remotes.some(remote => remote.name === "origin") ? "origin" : repository.state.remotes[0]?.name)
    const remote = repository.state.remotes.find(candidate => candidate.name === remoteName)
    if (!remoteName || !remote) throw new Error("当前仓库没有远程仓库。")
    const hosted = hostedRepository(remote.pushUrl ?? remote.fetchUrl ?? "")
    if (!hosted) throw new Error(`暂只支持 github.com 与 gitlab.com 远程，${remoteName} 不在其中。`)
    const base = (await git(["symbolic-ref", "--short", `refs/remotes/${remoteName}/HEAD`], root).catch(() => "")).trim().replace(`${remoteName}/`, "")
      || ((await git(["show-ref", "--verify", "--quiet", `refs/remotes/${remoteName}/main`], root).then(() => true, () => false)) ? "main" : "master")
    if (branch === base) throw new Error(`当前分支就是默认分支 ${base}，请先切换到功能分支。`)
    const unpushed = !head.upstream ? "该分支还没有推送到远程。" : (head.ahead ?? 0) > 0 ? `有 ${head.ahead} 个提交尚未推送。` : null
    if (unpushed) {
      const choice = await vscode.window.showWarningMessage(unpushed, { modal: true, detail: `推送会把分支 ${branch} 发布到 ${remoteName}（${hosted.host}/${hosted.path}）。` }, `推送到 ${remoteName} 并打开`, "只打开页面")
      if (!choice) return
      if (choice !== "只打开页面") await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `正在推送 ${branch}` }, () => repository.push(remoteName, branch, !head.upstream))
    }
    await vscode.env.openExternal(vscode.Uri.parse(pullRequestUrl(hosted, base, branch)))
  }

  return vscode.Disposable.from(
    guarded("codem.newWorktree", create),
    guarded("codem.openWorktree", open),
    guarded("codem.closeWorktree", close),
    guarded("codem.openPullRequest", pullRequest),
  )
}
