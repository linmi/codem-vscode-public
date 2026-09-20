import assert from "node:assert/strict"
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, toNamespacedPath } from "node:path"
import { it } from "node:test"
import { threadWorkspace } from "../src/threadWorkspace.ts"

it("Windows thread paths retain the host key only after verifying the real directory", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "codem workspace 中文 "))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = await realpath(temporary)
  const workspace = join(root, "Project")
  await mkdir(workspace)
  await mkdir(join(workspace, "child"))
  const spelling = `${workspace}/child/..`
  assert.equal(await threadWorkspace(spelling, workspace, "thread-1", "win32"), workspace)
  assert.equal(await threadWorkspace(workspace.replaceAll("\\", "/"), workspace, "thread-1", "win32"), workspace)
  assert.equal(await threadWorkspace(toNamespacedPath(workspace), workspace, "thread-1", "win32"), workspace)
  assert.equal(await threadWorkspace(workspace, workspace, "thread-1"), workspace)
  await assert.rejects(threadWorkspace(spelling, workspace, "thread-1", "linux"), /another workspace/)
  await assert.rejects(threadWorkspace(root, workspace, "thread-1", "win32"), /another workspace/)
  await assert.rejects(threadWorkspace("Project", workspace, "thread-1", "win32"), /another workspace/)
  await assert.rejects(threadWorkspace(join(root, "missing"), workspace, "thread-1", "win32"), /Cannot verify workspace.*thread-1/)
  const outside = join(root, "outside")
  await mkdir(outside)
  await symlink(outside, join(workspace, "escape"), "junction")
  await assert.rejects(threadWorkspace(join(workspace, "escape"), workspace, "thread-1", "win32"), /another workspace/)
})
