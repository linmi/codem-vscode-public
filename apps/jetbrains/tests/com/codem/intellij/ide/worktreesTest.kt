package com.codem.intellij.ide

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

/** Ported from `apps/vscode/tests/worktree.test.ts` and `pullRequest.test.ts`; the git cases run the real git. */
class WorktreesTest {
    private val git = ProcessGit(
        environment = mapOf(
            "GIT_CONFIG_NOSYSTEM" to "1",
            "GIT_AUTHOR_NAME" to "t", "GIT_AUTHOR_EMAIL" to "t@t",
            "GIT_COMMITTER_NAME" to "t", "GIT_COMMITTER_EMAIL" to "t@t",
        ),
    )
    private val worktrees = Worktrees(git)

    private fun git(cwd: Path, vararg args: String) = git.run(args.toList(), cwd)

    private fun repository(temp: Path): Path {
        val root = Files.createDirectories(temp.toRealPath().resolve("app"))
        git(root, "init", "-q", "-b", "main")
        Files.writeString(root.resolve("README.md"), "hello\n")
        git(root, "add", ".")
        git(root, "commit", "-q", "-m", "init")
        return root
    }

    @Test
    fun parsesPorcelainRecordsIncludingDetachedLockedAndPrunableWorktrees() {
        val entries = Worktrees.parseWorktreeList(
            "worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r.worktrees/x\nHEAD bbb\ndetached\nlocked reason\n\n" +
                "worktree /gone\nHEAD ccc\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n",
        )
        assertEquals(
            listOf(
                listOf("/r", "main", false, false, false),
                listOf("/r.worktrees/x", null, true, true, false),
                listOf("/gone", "old", false, false, true),
            ),
            entries.map { listOf(it.path, it.branch, it.detached, it.locked, it.prunable) },
        )
        assertEquals("分离头指针 bbb", entries[1].describe())
        assertEquals(emptyList<WorktreeEntry>(), Worktrees.parseWorktreeList(""))
    }

    @Test
    fun turnsFreeTextIntoABranchNameAndPlacesWorktreesBesideTheMainCheckout() {
        assertEquals("fix-login-timeout", Worktrees.suggestedBranch("  fix login timeout "))
        assertEquals("feat/a.b-c-d-e-f-g-h", Worktrees.suggestedBranch("feat/a..b~c^d:e?f*g[h]"))
        assertEquals("x-lock", Worktrees.suggestedBranch("-/x.lock/"))
        assertEquals("", Worktrees.suggestedBranch("..."))
        assertEquals(Path.of("/code", "app.worktrees", "fix-login"), Worktrees.worktreeLocation("/code/app", "fix/login"))
    }

    @Test
    fun keepsGitsReasonInsteadOfTheHintsThatFollowIt() {
        assertEquals("the branch 'x' is not fully merged", Worktrees.gitErrorMessage("error: the branch 'x' is not fully merged\nhint: If you are sure you want to delete it, run\nhint:   git branch -D x\n"))
        assertEquals("'a' is a missing but locked worktree;", Worktrees.gitErrorMessage("fatal: 'a' is a missing but locked worktree;\r\n"))
        assertEquals("Preparing worktree", Worktrees.gitErrorMessage("warning: something\nPreparing worktree\n"))
        assertNull(Worktrees.gitErrorMessage("hint: only a hint\n"))
        assertNull(Worktrees.gitErrorMessage(""))
    }

    @Test
    fun spellsAGitPathTheWayThisProjectsFolderWasOpened() {
        assertEquals("/tmp/a/app", Worktrees.asOpenedPath("/private/tmp/a/app", "/tmp/a/app.worktrees/x", "/private/tmp/a/app.worktrees/x"))
        assertEquals("/tmp/a/app.worktrees/y", Worktrees.asOpenedPath("/private/tmp/a/app.worktrees/y", "/tmp/a/app", "/private/tmp/a/app"))
        assertEquals("/code/app.worktrees/y", Worktrees.asOpenedPath("/code/app.worktrees/y", "/code/app", "/code/app"))
        assertEquals("/elsewhere/app", Worktrees.asOpenedPath("/elsewhere/app", "/tmp/a/app", "/private/tmp/a/app"))
        assertEquals("D:\\link\\app.worktrees\\y", Worktrees.asOpenedPath("C:\\real\\app.worktrees\\y", "D:\\link\\app", "C:\\real\\app", "\\"))
    }

    @Test
    fun createsANewBranchBesideTheRepositoryAndRefusesABranchAlreadyCheckedOut(@TempDir temp: Path) {
        val root = repository(temp)
        val path = worktrees.create(root, "fix/login", "main")
        assertEquals(root.parent.resolve("app.worktrees").resolve("fix-login"), path)
        assertTrue(Files.isRegularFile(path.resolve("README.md")))
        assertEquals("fix/login", git(path, "branch", "--show-current").trim())
        assertEquals(listOf("main", "fix/login"), worktrees.list(root).map { it.branch })
        assertEquals(root, worktrees.root(path.resolve("..").resolve("..").resolve("app")))
        // From inside the worktree the location is still computed from the main checkout.
        assertTrue(assertThrows(GitFailure::class.java) { worktrees.create(path, "fix/login", "main") }.message!!.contains("已在"))
        assertTrue(assertThrows(GitFailure::class.java) { worktrees.create(root, "main", "main") }.message!!.contains("已在"))
        assertTrue(assertThrows(GitFailure::class.java) { worktrees.create(root, "bad..name", "main") }.message!!.contains("不是有效的分支名"))
        assertEquals("分支名无效。", assertThrows(GitFailure::class.java) { worktrees.create(root, "-x", "main") }.message)
        assertEquals("main", worktrees.base(root))
    }

    @Test
    fun checksOutAnExistingBranchWithoutMovingItAndNeverOverwritesAFolder(@TempDir temp: Path) {
        val root = repository(temp)
        git(root, "branch", "feature")
        val before = git(root, "rev-parse", "feature").trim()
        val path = worktrees.create(root, "feature", "does-not-matter")
        assertEquals(before, git(path, "rev-parse", "HEAD").trim())
        git(root, "branch", "other")
        val occupied = Files.createDirectories(Worktrees.worktreeLocation(root.toString(), "other"))
        Files.writeString(occupied.resolve("keep.txt"), "mine")
        assertTrue(assertThrows(GitFailure::class.java) { worktrees.create(root, "other", "main") }.message!!.contains("already exists"))
        assertTrue(Files.isRegularFile(occupied.resolve("keep.txt")))
    }

    @Test
    fun removesOnlyLinkedWorktreesNeedsForceForChangesAndKeepsAnUnmergedBranch(@TempDir temp: Path) {
        val root = repository(temp)
        val clean = worktrees.create(root, "clean", "main")
        val dirty = worktrees.create(root, "dirty", "main")
        val (main, cleanEntry, dirtyEntry) = worktrees.list(root)
        assertTrue(assertThrows(GitFailure::class.java) { worktrees.remove(root, main, force = true, deleteBranch = false) }.message!!.contains("主工作区"))

        assertEquals(emptyList<String>(), worktrees.changes(clean))
        assertEquals(Worktrees.Removal(true, null), worktrees.remove(root, cleanEntry, force = false, deleteBranch = true))
        assertFalse(Files.exists(clean))
        assertFalse(worktrees.branchExists(root, "clean"))
        assertTrue(assertThrows(GitFailure::class.java) { worktrees.remove(root, cleanEntry, force = false, deleteBranch = false) }.message!!.contains("已不存在"))

        Files.writeString(dirty.resolve("new.txt"), "draft")
        assertEquals(1, worktrees.changes(dirty).size)
        assertThrows(GitFailure::class.java) { worktrees.remove(root, dirtyEntry, force = false, deleteBranch = false) }
        assertTrue(Files.isRegularFile(dirty.resolve("new.txt")))

        git(dirty, "add", ".")
        git(dirty, "commit", "-q", "-m", "work")
        val result = worktrees.remove(root, dirtyEntry, force = false, deleteBranch = true)
        assertFalse(result.branchDeleted)
        assertTrue(result.branchError!!.contains("not fully merged"))
        assertTrue(worktrees.branchExists(root, "dirty"))
    }

    @Test
    fun findsTheRemotesDefaultBranchFromItsHeadElseMainElseMaster(@TempDir temp: Path) {
        val root = repository(temp)
        git(root, "remote", "add", "gone", root.parent.resolve("missing.git").toString())
        assertEquals("master", worktrees.defaultBranch(root, "gone"))
        git(root, "update-ref", "refs/remotes/gone/main", "HEAD")
        assertEquals("main", worktrees.defaultBranch(root, "gone"))
        val remote = root.parent.resolve("remote.git").toString()
        git(root, "init", "-q", "--bare", "-b", "trunk", remote)
        git(root, "remote", "add", "origin", remote)
        git(root, "push", "-q", "origin", "main", "main:trunk")
        assertEquals("trunk", worktrees.defaultBranch(root, "origin"))
        git(root, "remote", "set-head", "origin", "main")
        assertEquals("main", worktrees.defaultBranch(root, "origin"))
    }

    /** The PR command's facts come from git: upstream remote, unpushed commits and each remote's push URL. */
    @Test
    fun readsTheBranchUpstreamAndPushesOnlyWhenAsked(@TempDir temp: Path) {
        val root = repository(temp)
        val remote = root.parent.resolve("remote.git").toString()
        git(root, "init", "-q", "--bare", "-b", "main", remote)
        git(root, "remote", "add", "origin", remote)
        git(root, "switch", "-q", "-c", "feat/x")
        assertEquals(BranchState("feat/x", null, 0), worktrees.branchState(root))
        assertEquals(listOf(GitRemote("origin", remote)), worktrees.remotes(root))
        worktrees.push(root, "origin", "feat/x", setUpstream = true)
        Files.writeString(root.resolve("a.txt"), "a")
        git(root, "add", ".")
        git(root, "commit", "-q", "-m", "a")
        assertEquals(BranchState("feat/x", "origin", 1), worktrees.branchState(root))
        git(root, "checkout", "-q", "--detach")
        assertEquals("当前不在任何分支上，请先检出分支。", assertThrows(GitFailure::class.java) { worktrees.branchState(root) }.message)
    }

    /** Update from base merges, refuses a dirty tree and reports a conflict without losing the merge state. */
    @Test
    fun updatesTheCurrentBranchFromTheRemoteDefaultBranchByMerging(@TempDir temp: Path) {
        val root = repository(temp)
        val remote = root.parent.resolve("remote.git").toString()
        git(root, "init", "-q", "--bare", "-b", "main", remote)
        git(root, "remote", "add", "origin", remote)
        git(root, "push", "-q", "origin", "main")
        git(root, "switch", "-q", "-c", "feat/x")
        Files.writeString(root.resolve("feature.txt"), "f")
        git(root, "add", ".")
        git(root, "commit", "-q", "-m", "feature")
        // Someone else moves main on the remote.
        val other = root.parent.resolve("other")
        git(root.parent, "clone", "-q", remote, other.toString())
        Files.writeString(other.resolve("README.md"), "hello from main\n")
        git(other, "commit", "-q", "-am", "main moves")
        git(other, "push", "-q", "origin", "main")

        Files.writeString(root.resolve("draft.txt"), "draft")
        assertEquals("当前有未提交的修改，请先提交或储藏后再更新。", assertThrows(GitFailure::class.java) { worktrees.updateFromBase(root, "origin", "main") }.message)
        Files.delete(root.resolve("draft.txt"))
        assertEquals("origin/main", worktrees.updateFromBase(root, "origin", "main"))
        assertEquals("hello from main\n", Files.readString(root.resolve("README.md")))
        assertEquals(2, git(root, "rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ").size - 1, "A merge commit, not a rebase")

        Files.writeString(other.resolve("feature.txt"), "theirs")
        git(other, "add", ".")
        git(other, "commit", "-q", "-m", "conflict")
        git(other, "push", "-q", "origin", "main")
        assertTrue(assertThrows(GitFailure::class.java) { worktrees.updateFromBase(root, "origin", "main") }.message!!.contains("冲突"))
        assertTrue(Files.exists(root.resolve(".git").resolve("MERGE_HEAD")))
    }

    @Test
    fun recognisesGitHubAndGitLabRemotesAndNothingElse() {
        for (url in listOf("https://github.com/linmi/codem-vscode-public.git", "https://token@github.com/linmi/codem-vscode-public", "git@github.com:linmi/codem-vscode-public.git", "ssh://git@github.com:22/linmi/codem-vscode-public/")) {
            assertEquals(HostedRepository("github.com", "linmi/codem-vscode-public", HostedRepository.Kind.GitHub), PullRequests.hostedRepository(url), url)
        }
        assertEquals(HostedRepository("gitlab.com", "group/sub/project", HostedRepository.Kind.GitLab), PullRequests.hostedRepository("git@gitlab.com:group/sub/project.git"))
        for (url in listOf("https://git.example.com/a/b.git", "https://github.com/only-owner", "/local/path/repo", "", "https://github.com/a/b/c")) {
            assertNull(PullRequests.hostedRepository(url), url)
        }
    }

    @Test
    fun buildsTheHostsOwnNewPullOrMergeRequestPage() {
        assertEquals("https://github.com/linmi/app/compare/main...feat/x%20y?expand=1", PullRequests.url(HostedRepository("github.com", "linmi/app", HostedRepository.Kind.GitHub), "main", "feat/x y"))
        assertEquals(
            "https://gitlab.com/g/p/-/merge_requests/new?merge_request%5Bsource_branch%5D=fix%2Fa&merge_request%5Btarget_branch%5D=main",
            PullRequests.url(HostedRepository("gitlab.com", "g/p", HostedRepository.Kind.GitLab), "main", "fix/a"),
        )
    }
}
