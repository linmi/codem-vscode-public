import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { it, type TestContext } from "node:test"
import { parseWorktreeList, suggestedBranch, worktreeLocation, Worktrees, type GitRunner } from "../src/integrations/worktree.ts"

const git: GitRunner = (args, cwd) => new Promise((resolve, reject) => {
  execFile("git", [...args], { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }, (error, stdout, stderr) => error ? reject(new Error(String(stderr).trim() || error.message)) : resolve(String(stdout)))
})

async function repository(t: TestContext): Promise<string> {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "codem-worktree-")))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, "app")
  await mkdir(root)
  await git(["init", "-q", "-b", "main"], root)
  await writeFile(join(root, "README.md"), "hello\n")
  await git(["add", "."], root)
  await git(["commit", "-q", "-m", "init"], root)
  return root
}

it("parses porcelain records including detached, locked and prunable worktrees", () => {
  const entries = parseWorktreeList("worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r.worktrees/x\nHEAD bbb\ndetached\nlocked reason\n\nworktree /gone\nHEAD ccc\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n")
  assert.deepEqual(entries.map(entry => [entry.path, entry.branch, entry.detached, entry.locked, entry.prunable]), [["/r", "main", false, false, false], ["/r.worktrees/x", null, true, true, false], ["/gone", "old", false, false, true]])
  assert.deepEqual(parseWorktreeList(""), [])
})

it("turns free text into a branch-like name and places worktrees beside the main checkout", () => {
  assert.equal(suggestedBranch("  fix login timeout "), "fix-login-timeout")
  assert.equal(suggestedBranch("feat/a..b~c^d:e?f*g[h]"), "feat/a.b-c-d-e-f-g-h")
  assert.equal(suggestedBranch("-/x.lock/"), "x-lock")
  assert.equal(suggestedBranch("..."), "")
  assert.equal(worktreeLocation("/code/app", "fix/login"), join("/code", "app.worktrees", "fix-login"))
})

it("creates a new branch from the base beside the repository and refuses a branch already checked out", async t => {
  const root = await repository(t)
  const worktrees = new Worktrees(git)
  const path = await worktrees.create(root, "fix/login", "main")
  assert.equal(path, join(root, "..", "app.worktrees", "fix-login"))
  assert.ok((await stat(join(path, "README.md"))).isFile())
  assert.equal((await git(["branch", "--show-current"], path)).trim(), "fix/login")
  const listed = await worktrees.list(root)
  assert.deepEqual(listed.map(entry => entry.branch), ["main", "fix/login"])
  // From inside the worktree the location is still computed from the main checkout.
  await assert.rejects(worktrees.create(path, "fix/login", "main"), /已在 .* 检出/)
  await assert.rejects(worktrees.create(root, "main", "main"), /已在 .* 检出/)
  await assert.rejects(worktrees.create(root, "bad..name", "main"), /不是有效的分支名/)
  await assert.rejects(worktrees.create(root, "-x", "main"), /分支名无效/)
})

it("checks out an existing branch that no worktree holds, without moving it", async t => {
  const root = await repository(t)
  await git(["branch", "feature"], root)
  const before = (await git(["rev-parse", "feature"], root)).trim()
  const worktrees = new Worktrees(git)
  const path = await worktrees.create(await realpath(root), "feature", "does-not-matter")
  assert.equal((await git(["rev-parse", "HEAD"], path)).trim(), before)
  // A folder already at the location is git's error, surfaced as is; nothing is overwritten.
  await git(["branch", "other"], root)
  await mkdir(worktreeLocation(root, "other"), { recursive: true })
  await writeFile(join(worktreeLocation(root, "other"), "keep.txt"), "mine")
  await assert.rejects(worktrees.create(root, "other", "main"), /already exists/)
  assert.ok((await stat(join(worktreeLocation(root, "other"), "keep.txt"))).isFile())
})
