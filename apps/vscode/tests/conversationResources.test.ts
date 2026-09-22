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

const pastedPng = { mediaType: "image/png" as const, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==" }

it("pasted images become private local attachments and retain previews after send, until the conversation is cleared", async t => {
  const { readFile, stat } = await import("node:fs/promises")
  const resources = new ConversationResources()
  t.after(async () => { resources.clear(); await resources.disposeImages() })
  const added = await resources.addPastedImages([pastedPng], () => {})
  const path = resources.selected()[0]!.path
  resources.retainImages([], []) // A snapshot emitted before the import receipt cannot discard selected bytes.
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal((await readFile(path)).toString("base64"), pastedPng.data)
  assert.equal(added[0]!.label, "粘贴图片.png")
  resources.clear(true) // Initial connection preserves the staged clipboard image.
  assert.deepEqual(resources.attachmentViews("/workspace"), added)
  resources.remove(added[0]!.id)
  resources.retainImages([], [{ id: "sent", role: "user", label: "你", text: "图片", attachments: added }])
  assert.deepEqual(await resources.loadImage(added[0]!.id), { kind: "image", dataUrl: `data:image/png;base64,${pastedPng.data}` })
  resources.clear()
  await resources.finishImageCleanup()
  await assert.rejects(readFile(path), { code: "ENOENT" })
})

it("removing an unsent image deletes only its owned temporary file", async t => {
  const { readFile } = await import("node:fs/promises")
  const resources = new ConversationResources()
  t.after(() => resources.disposeImages())
  const [added] = await resources.addPastedImages([pastedPng], () => {})
  const path = resources.selected()[0]!.path
  resources.remove(added!.id); resources.retainImages([], [])
  await resources.finishImageCleanup()
  await assert.rejects(readFile(path), { code: "ENOENT" })
})

it("pasted image batches are atomic for wrong MIME, non-canonical base64, count limits and cancellation", async t => {
  const resources = new ConversationResources()
  t.after(() => resources.disposeImages())
  await assert.rejects(resources.addPastedImages([pastedPng, { ...pastedPng, mediaType: "image/jpeg" }], () => {}), /格式无效/)
  await assert.rejects(resources.addPastedImages([{ mediaType: "image/png", data: "iVBORw0KGgp=" }], () => {}), /格式无效/)
  assert.deepEqual(resources.selected(), [])
  const pending = resources.addPastedImages([pastedPng], () => {})
  resources.clear()
  await assert.rejects(pending, /expired/)
  await assert.rejects(resources.addPastedImages([pastedPng], () => { throw new Error("untrusted") }), /untrusted/)
  await resources.addPastedImages(Array.from({ length: 20 }, () => pastedPng), () => {})
  await assert.rejects(resources.addPastedImages([pastedPng], () => {}), /20 个附件/)
  resources.clear(); await resources.finishImageCleanup()
  assert.deepEqual(resources.selected(), [])
})

it("retirement waits for Core to release pasted files before deleting them", async t => {
  const { readFile } = await import("node:fs/promises")
  const resources = new ConversationResources()
  t.after(() => resources.disposeImages())
  await resources.addPastedImages([pastedPng], () => {})
  const path = resources.selected()[0]!.path
  let close!: () => void
  const closing = new Promise<void>(resolve => { close = resolve })
  resources.clear(false, closing)
  assert.equal((await readFile(path)).toString("base64"), pastedPng.data)
  close(); await resources.finishImageCleanup()
  await assert.rejects(readFile(path), { code: "ENOENT" })
})


it("keeps a private root stable across conversation resets and removes it only on disposal", async () => {
  const { stat } = await import("node:fs/promises")
  const resources = new ConversationResources()
  const root = resources.rootForCore()
  assert.equal((await stat(root)).mode & 0o777, 0o700)
  await resources.addPastedImages([pastedPng], () => {})
  assert.ok(resources.selected()[0]!.path.startsWith(root + "/"))
  resources.clear(); await resources.finishImageCleanup()
  assert.equal(resources.rootForCore(), root)
  await resources.addPastedImages([pastedPng], () => {})
  assert.ok(resources.selected()[0]!.path.startsWith(root + "/"))
  resources.clear(); await resources.disposeImages()
  await assert.rejects(stat(root), { code: "ENOENT" })
})
