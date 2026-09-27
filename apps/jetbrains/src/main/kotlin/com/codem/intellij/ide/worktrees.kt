package com.codem.intellij.ide

import java.nio.file.Path
import java.util.concurrent.TimeUnit

/**
 * Git worktree operations, ported from the VS Code `integrations/worktree.ts` and `worktreeActions.ts`. They read and
 * write only git's own records and keep nothing in memory between calls; the new folder opens as its own IDE project,
 * where CodeM connects like in any other workspace.
 */
data class WorktreeEntry(
    val path: String,
    val branch: String?,
    val head: String?,
    val detached: Boolean,
    val bare: Boolean,
    val locked: Boolean,
    val prunable: Boolean,
) {
    /** The branch, else a detached head, else the folder name. */
    fun describe(): String = branch ?: if (detached) "分离头指针 ${head?.take(8).orEmpty()}" else Path.of(path).fileName?.toString() ?: path
}

/** A git command that failed; the message is git's own reason, readable in a dialog. */
class GitFailure(message: String) : RuntimeException(message)

/** Runs git in a directory and returns stdout; throws [GitFailure] with git's reason. */
fun interface GitRunner {
    fun run(args: List<String>, cwd: Path): String
}

/** Git as a child process. Never prompts for credentials: nothing can answer, and a hidden prompt would hang. */
class ProcessGit(
    private val executable: String = "git",
    private val environment: Map<String, String> = emptyMap(),
    private val timeoutMs: Long = 120_000,
) : GitRunner {
    override fun run(args: List<String>, cwd: Path): String {
        val builder = ProcessBuilder(listOf(executable) + args).directory(cwd.toFile())
        builder.environment().putAll(environment)
        builder.environment()["GIT_TERMINAL_PROMPT"] = "0"
        val process = try {
            builder.start()
        } catch (error: java.io.IOException) {
            throw GitFailure("找不到 git，请先安装 Git 并确认 IDE 能在 PATH 中找到它。")
        }
        process.outputStream.close()
        val stderr = StringBuilder()
        val reader = Thread { stderr.append(process.errorStream.bufferedReader().readText()) }.apply { isDaemon = true; start() }
        val stdout = process.inputStream.bufferedReader().readText()
        if (!process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) {
            process.destroyForcibly()
            throw GitFailure("git ${args.firstOrNull().orEmpty()} 超时。")
        }
        reader.join(1_000)
        if (process.exitValue() != 0) throw GitFailure(Worktrees.gitErrorMessage(stderr.toString()) ?: "git ${args.firstOrNull().orEmpty()} 失败。")
        return stdout
    }
}

/** The current branch as git records it: its upstream remote, if any, and how many commits are not pushed. */
data class BranchState(val branch: String, val upstreamRemote: String?, val ahead: Int)

data class GitRemote(val name: String, val url: String)

class Worktrees(private val git: GitRunner) {
    fun list(repository: Path): List<WorktreeEntry> = parseWorktreeList(git.run(listOf("worktree", "list", "--porcelain"), repository))

    /** The top of the checkout containing [path]; a project opened below it still uses its repository. */
    fun root(path: Path): Path = try {
        Path.of(git.run(listOf("rev-parse", "--show-toplevel"), path).trim())
    } catch (_: GitFailure) {
        throw GitFailure("当前项目不在 Git 仓库中。")
    }

    /** Throws when the name is not a valid branch. */
    fun assertBranchName(repository: Path, branch: String) {
        if (branch.isEmpty() || branch.startsWith("-")) throw GitFailure("分支名无效。")
        try {
            git.run(listOf("check-ref-format", "--branch", branch), repository)
        } catch (_: GitFailure) {
            throw GitFailure("「$branch」不是有效的分支名。")
        }
    }

    fun branchExists(repository: Path, branch: String): Boolean = succeeds(listOf("show-ref", "--verify", "--quiet", "refs/heads/$branch"), repository)

    /** The branch a new worktree starts from: the current branch, else the current commit; null before the first commit. */
    fun base(repository: Path): String? =
        currentBranch(repository) ?: runCatching { git.run(listOf("rev-parse", "-q", "--verify", "HEAD"), repository).trim() }.getOrNull()?.ifEmpty { null }

    fun currentBranch(repository: Path): String? =
        runCatching { git.run(listOf("symbolic-ref", "--short", "-q", "HEAD"), repository).trim() }.getOrNull()?.ifEmpty { null }

    /**
     * Creates the worktree for [branch] beside the main checkout. A new branch starts from [base]; an existing branch
     * that no worktree has checked out is reused as is. Returns the new worktree's path.
     */
    fun create(repository: Path, branch: String, base: String): Path {
        assertBranchName(repository, branch)
        val worktrees = list(repository)
        val main = worktrees.firstOrNull()
        if (main == null || main.bare) throw GitFailure("无法确定主工作区，暂不支持裸仓库。")
        worktrees.firstOrNull { it.branch == branch }?.let { throw GitFailure("分支 $branch 已在 ${it.path} 检出，可以直接打开该 worktree。") }
        val path = worktreeLocation(main.path, branch)
        if (worktrees.any { Path.of(it.path) == path }) throw GitFailure("$path 已是一个 worktree。")
        val args = if (branchExists(repository, branch)) listOf("worktree", "add", "--", path.toString(), branch)
        else listOf("worktree", "add", "-b", branch, "--", path.toString(), base)
        git.run(args, repository)
        return path
    }

    /** Uncommitted and untracked changes in one worktree, as `git status --porcelain` lines. */
    fun changes(worktree: Path): List<String> =
        git.run(listOf("status", "--porcelain", "--untracked-files=normal"), worktree).lines().filter { it.isNotBlank() }

    data class Removal(val branchDeleted: Boolean, val branchError: String?)

    /**
     * Removes a linked worktree; never the main one. Without [force] git refuses a worktree with changes. The branch
     * stays unless [deleteBranch], which uses `git branch -d` and so keeps a branch that is not merged.
     */
    fun remove(repository: Path, entry: WorktreeEntry, force: Boolean, deleteBranch: Boolean): Removal {
        val worktrees = list(repository)
        if (worktrees.firstOrNull()?.path == entry.path) throw GitFailure("不能删除主工作区。")
        if (worktrees.none { it.path == entry.path }) throw GitFailure("该 worktree 已不存在，请刷新后重试。")
        if (entry.locked) throw GitFailure("该 worktree 已锁定，请先用 git worktree unlock 解锁。")
        git.run(listOf("worktree", "remove") + (if (force) listOf("--force") else emptyList()) + listOf("--", entry.path), repository)
        val branch = entry.branch
        if (!deleteBranch || branch == null) return Removal(false, null)
        return try {
            git.run(listOf("branch", "-d", "--", branch), repository)
            Removal(true, null)
        } catch (error: GitFailure) {
            Removal(false, error.message)
        }
    }

    /** Throws when HEAD is not on a branch, as the PR and update commands need one. */
    fun branchState(repository: Path): BranchState {
        val branch = currentBranch(repository) ?: throw GitFailure("当前不在任何分支上，请先检出分支。")
        val remote = runCatching { git.run(listOf("config", "--get", "branch.$branch.remote"), repository).trim() }.getOrNull()
            ?.takeIf { it.isNotEmpty() && it != "." }
        val ahead = if (remote == null) 0 else runCatching {
            git.run(listOf("rev-list", "--count", "@{upstream}..HEAD"), repository).trim().toInt()
        }.getOrDefault(0)
        return BranchState(branch, remote, ahead)
    }

    /** Each remote with the URL a push would use. */
    fun remotes(repository: Path): List<GitRemote> =
        git.run(listOf("remote"), repository).lines().map { it.trim() }.filter { it.isNotEmpty() }.map { name ->
            GitRemote(name, runCatching { git.run(listOf("remote", "get-url", "--push", "--", name), repository).trim() }.getOrDefault(""))
        }

    fun push(repository: Path, remote: String, branch: String, setUpstream: Boolean) {
        git.run(listOf("push") + (if (setUpstream) listOf("-u") else emptyList()) + listOf("--", remote, branch), repository)
    }

    /**
     * The remote's default branch: `refs/remotes/<remote>/HEAD` when known locally, else the remote's own HEAD (one
     * `ls-remote`, only when the local ref is missing), else `main` when the remote has one, else `master`.
     */
    fun defaultBranch(repository: Path, remote: String): String {
        val head = runCatching { git.run(listOf("symbolic-ref", "--short", "refs/remotes/$remote/HEAD"), repository).trim() }.getOrDefault("")
        if (head.startsWith("$remote/")) return head.removePrefix("$remote/")
        val advertised = runCatching { git.run(listOf("ls-remote", "--symref", "--", remote, "HEAD"), repository) }.getOrDefault("")
            .let { Regex("""^ref: refs/heads/(\S+)\tHEAD$""", RegexOption.MULTILINE).find(it)?.groupValues?.get(1) }
        if (advertised != null) return advertised
        return if (succeeds(listOf("show-ref", "--verify", "--quiet", "refs/remotes/$remote/main"), repository)) "main" else "master"
    }

    /**
     * Fetches the remote's default branch and merges it into the current branch. A merge, never a rebase, so no pushed
     * commit is rewritten; a dirty tree is refused so a conflict never mixes with uncommitted work. Returns the merged
     * ref, `<remote>/<base>`.
     */
    fun updateFromBase(repository: Path, remote: String, base: String): String {
        if (changes(repository).isNotEmpty()) throw GitFailure("当前有未提交的修改，请先提交或储藏后再更新。")
        val target = "$remote/$base"
        git.run(listOf("fetch", "--", remote, base), repository)
        try {
            git.run(listOf("merge", "--no-edit", target), repository)
        } catch (error: GitFailure) {
            // Conflicts leave the merge in progress; the IDE's Git tools resolve or abort it.
            if (runCatching { changes(repository) }.getOrDefault(emptyList()).isNotEmpty()) {
                throw GitFailure("合并 $target 时出现冲突，请在 Git 工具窗口中解决，或执行 git merge --abort 放弃。")
            }
            throw error
        }
        return target
    }

    private fun succeeds(args: List<String>, repository: Path): Boolean = try {
        git.run(args, repository)
        true
    } catch (_: GitFailure) {
        false
    }

    companion object {
        /** `git worktree list --porcelain`: records separated by blank lines, the main worktree first. */
        fun parseWorktreeList(output: String): List<WorktreeEntry> =
            output.replace("\r\n", "\n").split(Regex("\n\n+")).mapNotNull { block ->
                val lines = block.split("\n").filter { it.isNotEmpty() }
                val path = lines.firstOrNull { it.startsWith("worktree ") }?.removePrefix("worktree ") ?: return@mapNotNull null
                fun value(key: String) = lines.firstOrNull { it == key || it.startsWith("$key ") }
                val branch = value("branch")?.removePrefix("branch ")
                WorktreeEntry(
                    path = path,
                    branch = branch?.removePrefix("refs/heads/"),
                    head = value("HEAD")?.removePrefix("HEAD "),
                    detached = value("detached") != null,
                    bare = value("bare") != null,
                    locked = value("locked") != null,
                    prunable = value("prunable") != null,
                )
            }

        /** A readable branch name from free text; git itself has the final say through check-ref-format. */
        fun suggestedBranch(input: String): String = input.trim()
            .replace(Regex("""[\s~^:?*\[\\\]]+"""), "-")
            .replace(Regex("""\.{2,}"""), ".")
            .replace("@{", "-")
            .replace(Regex("/{2,}"), "/")
            .replace(Regex("""(^[-./]+)|([-./]+$)"""), "")
            .replace(Regex("""\.lock(?=/|$)"""), "-lock")
            .take(100)

        /** Worktrees live beside the main checkout (`<parent>/<repo>.worktrees/<branch>`), never inside it. */
        fun worktreeLocation(mainWorktree: String, branch: String): Path {
            val main = Path.of(mainWorktree)
            val parent = main.parent ?: main
            return parent.resolve("${main.fileName}.worktrees").resolve(branch.replace('/', '-'))
        }

        /**
         * [target] spelled the way this project's folder was opened. Git reports real paths, so a checkout opened
         * through a symlink (macOS `/tmp` → `/private/tmp`) would otherwise open a second window instead of focusing
         * the one already showing it.
         */
        fun asOpenedPath(target: String, opened: String, openedReal: String, separator: String = "/"): String {
            val a = opened.split(separator)
            val b = openedReal.split(separator)
            var shared = 0
            while (shared < a.size && shared < b.size && a[a.size - 1 - shared] == b[b.size - 1 - shared]) shared++
            val openedPrefix = a.take(a.size - shared).joinToString(separator)
            val realPrefix = b.take(b.size - shared).joinToString(separator)
            if (openedPrefix == realPrefix || realPrefix.isEmpty() || !target.startsWith(realPrefix + separator)) return target
            return openedPrefix + target.substring(realPrefix.length)
        }

        /**
         * The line of git's stderr that says what went wrong: the first `error:` or `fatal:` line, else the last line
         * that is not a `hint:`. Hints come last and would otherwise replace the reason.
         */
        fun gitErrorMessage(stderr: String): String? {
            val lines = stderr.replace("\r\n", "\n").split("\n").map { it.trim() }.filter { it.isNotEmpty() }
            val reason = lines.firstOrNull { Regex("^(error|fatal):").containsMatchIn(it) } ?: lines.lastOrNull { !it.startsWith("hint:") }
            return reason?.replace(Regex("""^(error|fatal):\s*"""), "")
        }
    }
}
