package com.codem.intellij.ide

import com.intellij.ide.BrowserUtil
import com.intellij.ide.impl.OpenProjectTask
import com.intellij.ide.impl.ProjectUtil
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.InputValidatorEx
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.util.ThrowableComputable
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.DoubleClickListener
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.EnvironmentUtil
import java.awt.event.MouseEvent
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.JComponent
import javax.swing.ListSelectionModel

/**
 * Tools > CodeM worktree commands, as the VS Code ones: git runs in a modal progress (stopping it midway could leave a
 * half-created worktree), one operation at a time across projects, and a worktree always opens as its own project in a
 * new window, where CodeM connects to it like to any other workspace.
 */
abstract class WorktreeAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabled = event.project?.basePath != null
    }

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val base = project.basePath?.let { Path.of(it) } ?: return
        if (!busy.compareAndSet(false, true)) {
            Messages.showInfoMessage(project, "另一个 worktree 操作仍在进行。", TITLE)
            return
        }
        try {
            if (!IdeaWorkspaceTrust(project).isTrusted(base)) throw GitFailure("请先信任此项目，再使用 worktree 命令。")
            WorktreeCommand(project, base).perform()
        } catch (error: GitFailure) {
            Messages.showErrorDialog(project, error.message ?: "worktree 操作失败。", TITLE)
        } catch (error: Exception) {
            log.warn("CodeM worktree command failed", error)
            Messages.showErrorDialog(project, "worktree 操作失败。", TITLE)
        } finally {
            busy.set(false)
        }
    }

    protected abstract fun WorktreeCommand.perform()

    companion object {
        const val TITLE = "CodeM worktree"
        private val busy = AtomicBoolean(false)
        private val log = Logger.getInstance(WorktreeAction::class.java)
    }
}

/** What each command needs: the project, git with the login shell's PATH, and a modal progress for git calls. */
class WorktreeCommand(val project: Project, private val base: Path) {
    private val log = Logger.getInstance(WorktreeCommand::class.java)
    val worktrees = Worktrees(ProcessGit(environment = EnvironmentUtil.getValue("PATH")?.let { mapOf("PATH" to it) } ?: emptyMap()))

    fun <T> git(title: String, operation: (Worktrees) -> T): T =
        ProgressManager.getInstance().runProcessWithProgressSynchronously(
            ThrowableComputable<T, GitFailure> { operation(worktrees) },
            title,
            false,
            project,
        )

    /** The repository this project belongs to; a project opened below its top still uses it. */
    fun repository(): Path = git("正在读取 Git 仓库") { it.root(base) }

    /** The project's folder as the IDE opened it, compared by real path. */
    fun isCurrent(path: String): Boolean = realPath(Path.of(path)) == realPath(base)

    /**
     * Opens [path] as a project in a new window. It is respelled like this project's folder, so a window already
     * showing it is focused rather than duplicated.
     */
    fun openWindow(path: String) {
        val opened = base.toString()
        val target = Worktrees.asOpenedPath(path, opened, realPath(base).toString(), java.io.File.separator)
        ProjectUtil.openOrImport(Path.of(target), OpenProjectTask { forceOpenInNewFrame = true })
    }

    fun timed(label: String, started: Long) = log.info("CodeM $label: ${(System.nanoTime() - started) / 1_000_000}ms")

    private fun realPath(path: Path): Path = runCatching { path.toRealPath() }.getOrDefault(path)
}

/** A modal list: returns the chosen index, or -1 when dismissed. Double-click or Enter chooses. */
private fun choose(project: Project, title: String, labels: List<String>): Int {
    val list = JBList(labels).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        selectedIndex = 0
        visibleRowCount = labels.size.coerceIn(3, 12)
    }
    val dialog = object : DialogWrapper(project) {
        init {
            this.title = title
            init()
        }

        override fun createCenterPanel(): JComponent = JBScrollPane(list).apply { preferredSize = java.awt.Dimension(560, preferredSize.height) }

        override fun getPreferredFocusedComponent(): JComponent = list
    }
    object : DoubleClickListener() {
        override fun onDoubleClick(event: MouseEvent): Boolean {
            dialog.close(DialogWrapper.OK_EXIT_CODE)
            return true
        }
    }.installOn(list)
    return if (dialog.showAndGet()) list.selectedIndex else -1
}

class NewWorktreeAction : WorktreeAction() {
    override fun WorktreeCommand.perform() {
        val (root, start) = git("正在读取 Git 仓库") { it.root(Path.of(project.basePath!!)).let { root -> root to it.base(root) } }
        val from = start ?: throw GitFailure("当前仓库还没有提交，无法新建 worktree。")
        val input = Messages.showInputDialog(
            project,
            "新分支从 ${if (from.length == 40) from.take(8) else from} 创建；填写已有且未检出的分支名则直接检出该分支。\n例如：fix/login-timeout",
            "新建 worktree",
            null,
            "",
            object : InputValidatorEx {
                override fun getErrorText(inputString: String): String? =
                    if (inputString.isNotBlank() && Worktrees.suggestedBranch(inputString).isEmpty()) "分支名无效。" else null
            },
        ) ?: return
        if (input.isBlank()) return
        val branch = Worktrees.suggestedBranch(input)
        val started = System.nanoTime()
        val path = git("正在创建 worktree $branch") { it.create(root, branch, from) }
        timed("worktree created", started)
        val open = Messages.showYesNoDialog(project, "已创建 worktree $branch：$path", TITLE, "在新窗口打开", "关闭", Messages.getInformationIcon())
        if (open == Messages.YES) openWindow(path.toString())
    }
}

class OpenWorktreeAction : WorktreeAction() {
    override fun WorktreeCommand.perform() {
        val root = repository()
        val entries = git("正在读取 worktree 列表") { it.list(root) }.withIndex()
            .filter { (_, entry) -> !entry.bare && !entry.prunable && !isCurrent(entry.path) }
        if (entries.isEmpty()) {
            Messages.showInfoMessage(project, "这个仓库还没有其他 worktree，可以使用「新建 worktree」创建。", TITLE)
            return
        }
        val labels = entries.map { (index, entry) ->
            val note = if (index == 0) "（主工作区）" else if (entry.locked) "（已锁定）" else ""
            "${entry.describe()}$note  ${entry.path}"
        }
        val picked = choose(project, "选择要在新窗口打开的 worktree", labels)
        if (picked >= 0) openWindow(entries[picked].value.path)
    }
}

/** Only another window may remove a worktree: this project's Core, terminals and indexes all live inside it. */
class RemoveWorktreeAction : WorktreeAction() {
    override fun WorktreeCommand.perform() {
        val root = repository()
        val entries = git("正在读取 worktree 列表") { it.list(root) }
        val main = entries.firstOrNull() ?: throw GitFailure("无法读取 worktree 列表。")
        if (!isCurrent(main.path)) {
            val open = Messages.showYesNoDialog(project, "当前窗口就在这个 worktree 中，请在主工作区窗口里删除它。", TITLE, "打开主工作区", "关闭", Messages.getInformationIcon())
            if (open == Messages.YES) openWindow(main.path)
            return
        }
        val linked = entries.drop(1).filter { !it.bare && !it.prunable }
        if (linked.isEmpty()) {
            Messages.showInfoMessage(project, "这个仓库没有可删除的 worktree。", TITLE)
            return
        }
        val labels = linked.map { "${it.describe()}${if (it.locked) "（已锁定）" else ""}  ${it.path}" }
        val index = choose(project, "选择要删除的 worktree", labels)
        if (index < 0) return
        val entry = linked[index]
        val changes = git("正在检查未提交的修改") { it.changes(Path.of(entry.path)) }
        val detail = buildString {
            append(entry.path).append("\n\n")
            append(if (changes.isNotEmpty()) "有 ${changes.size} 处未提交或未跟踪的修改，删除后无法恢复。" else "没有未提交的修改。")
            entry.branch?.let { append("\n分支 $it 默认保留；选择同时删除时，未合并的分支会保留。") }
            append("\n请先关闭打开该 worktree 的窗口。")
        }
        val options = listOfNotNull("删除 worktree", entry.branch?.let { "删除 worktree 和分支" }, "取消")
        val choice = Messages.showDialog(project, detail, "删除 worktree ${entry.describe()}？", options.toTypedArray(), options.lastIndex, Messages.getWarningIcon())
        if (choice < 0 || choice == options.lastIndex) return
        val deleteBranch = options[choice] == "删除 worktree 和分支"
        val result = git("正在删除 worktree ${entry.describe()}") { it.remove(root, entry, force = changes.isNotEmpty(), deleteBranch = deleteBranch) }
        when {
            result.branchError != null -> Messages.showWarningDialog(project, "worktree 已删除；分支 ${entry.branch} 未删除：${result.branchError}", TITLE)
            result.branchDeleted -> Messages.showInfoMessage(project, "已删除 worktree 和分支 ${entry.branch}。", TITLE)
            else -> Messages.showInfoMessage(project, "已删除 worktree ${entry.describe()}。", TITLE)
        }
    }
}

/** Opens the host's new-PR page for the current branch; pushing first is the person's explicit choice. */
class OpenPullRequestAction : WorktreeAction() {
    override fun WorktreeCommand.perform() {
        val root = repository()
        val (state, remotes) = git("正在读取分支") { it.branchState(root) to it.remotes(root) }
        if (remotes.isEmpty()) throw GitFailure("当前仓库没有远程仓库。")
        val hosted = remotes.mapNotNull { remote -> PullRequests.hostedRepository(remote.url)?.let { remote.name to it } }
        val upstream = state.upstreamRemote
        // The branch's upstream decides; without one, a single hosted remote is used and several are the person's choice.
        val chosen = when {
            upstream != null -> hosted.firstOrNull { it.first == upstream }
                ?: throw GitFailure("暂只支持 github.com 与 gitlab.com 远程，$upstream 不在其中。")
            hosted.isEmpty() -> throw GitFailure("暂只支持 github.com 与 gitlab.com 远程，当前仓库的远程都不在其中。")
            hosted.size == 1 -> hosted.single()
            else -> {
                val sorted = hosted.sortedByDescending { it.first == "origin" }
                val labels = sorted.map { (name, repo) -> "$name  ${repo.host}/${repo.path}" }
                val index = choose(project, "选择要为 ${state.branch} 打开 PR 的远程仓库", labels)
                if (index < 0) return
                sorted[index]
            }
        }
        val (remoteName, repository) = chosen
        val base = git("正在查询默认分支") { it.defaultBranch(root, remoteName) }
        if (base == state.branch) throw GitFailure("当前分支就是默认分支 $base，请先切换到功能分支。")
        val unpushed = when {
            upstream == null -> "该分支还没有推送到远程。"
            state.ahead > 0 -> "有 ${state.ahead} 个提交尚未推送。"
            else -> null
        }
        if (unpushed != null) {
            val options = arrayOf("推送到 $remoteName 并打开", "只打开页面", "取消")
            val choice = Messages.showDialog(project, "推送会把分支 ${state.branch} 发布到 $remoteName（${repository.host}/${repository.path}）。", unpushed, options, 0, Messages.getWarningIcon())
            if (choice < 0 || choice == 2) return
            if (choice == 0) git("正在推送 ${state.branch}") { it.push(root, remoteName, state.branch, setUpstream = upstream == null) }
        }
        BrowserUtil.browse(PullRequests.url(repository, base, state.branch))
    }
}

/**
 * Fetches the remote's default branch and merges it into the current branch: a merge, never a rebase, and no push.
 * A dirty tree is refused; on a conflict the IDE's version control window opens.
 */
class UpdateFromBaseAction : WorktreeAction() {
    override fun WorktreeCommand.perform() {
        val root = repository()
        val (state, remotes) = git("正在读取分支") { it.branchState(root) to it.remotes(root) }
        val remoteName = state.upstreamRemote ?: remotes.firstOrNull { it.name == "origin" }?.name ?: remotes.firstOrNull()?.name
            ?: throw GitFailure("当前仓库没有远程仓库。")
        val base = git("正在查询默认分支") { it.defaultBranch(root, remoteName) }
        if (base == state.branch) throw GitFailure("当前分支就是默认分支 $base，请先切换到功能分支。")
        val started = System.nanoTime()
        val target = try {
            git("正在把 $remoteName/$base 合并到 ${state.branch}") { it.updateFromBase(root, remoteName, base) }
        } catch (error: GitFailure) {
            // A conflict leaves the merge in progress; the version control window is where it is resolved or aborted.
            if (error.message?.contains("冲突") == true) {
                ToolWindowManager.getInstance(project).getToolWindow("Version Control")?.activate(null)
            }
            throw error
        }
        timed("updated from base", started)
        Messages.showInfoMessage(project, "已将 $target 合并到 ${state.branch}，尚未推送。", TITLE)
    }
}
