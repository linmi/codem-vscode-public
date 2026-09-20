import assert from "node:assert/strict"
import { it, type TestContext } from "node:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ConversationResources } from "../src/resources/conversationResources.ts"
import type { FileDiffContent } from "../src/resources/filePresentation.ts"

async function workspace(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "codem-resources-"))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await writeFile(join(cwd, "a.ts"), "content")
  return cwd
}

it("resource selection is atomic, deduplicated and does not consume attachments on failed validation", async t => {
  const cwd = await workspace(t)
  const resources = new ConversationResources()
  const item = { kind: "file" as const, path: join(cwd, "a.ts") }
  const added = await resources.add(cwd, [item, item], () => {})
  assert.equal(added.length, 1)
  assert.equal((await resources.add(cwd, [item], () => {})).length, 0)
  await assert.rejects(resources.add(cwd, [{ ...item, path: join(cwd, "missing") }], () => {}))
  assert.deepEqual(resources.selected(), [item])
  const selected = resources.selected()
  Object.assign(selected[0]!, { path: "mutated" })
  assert.deepEqual(resources.selected(), [item])
  resources.remove(added[0]!.id)
  assert.deepEqual(resources.selected(), [])
})

it("reset or revoked trust during attachment validation cannot repopulate resource handles", async t => {
  const cwd = await workspace(t)
  const resources = new ConversationResources()
  const chosen = [{ kind: "file" as const, path: join(cwd, "a.ts") }]
  const adding = resources.add(cwd, chosen, () => {})
  resources.clear()
  await assert.rejects(adding, /expired/)
  await assert.rejects(resources.add(cwd, chosen, () => { throw new Error("untrusted") }), /untrusted/)
  assert.deepEqual(resources.selectedIds(), [])
})

it("reset invalidates delayed search, artifact and diff handles together", async t => {
  const cwd = await workspace(t)
  const resources = new ConversationResources()
  let resolve!: (paths: readonly string[]) => void
  const search = resources.search(cwd, "a", () => new Promise(done => { resolve = done }))
  const [artifact] = resources.projectArtifacts([{ kind: "file", title: "a", path: "a.ts" }], cwd)
  const diff: FileDiffContent = { path: join(cwd, "a.ts"), changeType: "modified", stats: { linesAdded: 1, linesRemoved: 0 }, preview: { kind: "omitted" } }
  const first = resources.recordDiff(cwd, "turn", "item", diff)
  assert.equal(resources.recordDiff(cwd, "turn", "item", diff).id, first.id)
  const resolving = assert.rejects(resources.resolveArtifact(cwd, artifact!.id), /expired/)
  resources.clear()
  resolve([join(cwd, "a.ts")])
  assert.deepEqual(await search, [])
  await resolving
  assert.equal(resources.diff(first.id), undefined)
  assert.notEqual(resources.recordDiff(cwd, "turn", "item", diff).id, first.id)
})

it("connection binding can preserve draft attachment identities while retiring conversation handles", async t => {
  const cwd = await workspace(t)
  const resources = new ConversationResources()
  const added = await resources.add(null, [{ kind: "file", path: join(cwd, "a.ts") }], () => {})
  const [artifact] = resources.projectArtifacts([{ kind: "url", title: "result", uri: "https://example.com" }], cwd)
  resources.clear(true)
  assert.deepEqual(resources.attachmentViews(cwd), added)
  await assert.rejects(resources.resolveArtifact(cwd, artifact!.id), /expired/)
  resources.clear()
  assert.deepEqual(resources.attachmentViews(cwd), [])
})
