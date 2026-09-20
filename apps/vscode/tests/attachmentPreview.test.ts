import assert from "node:assert/strict"
import { it } from "node:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { attachmentPreview } from "../src/resources/attachmentPreview.ts"

it("projects only bounded raster bytes, never active SVG or host paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codemPreview"))
  const path = join(directory, "image")
  try {
    await writeFile(path, Buffer.from([137,80,78,71,13,10,26,10]))
    const preview = await attachmentPreview({ kind: "image", path })
    assert.equal(preview.kind, "image"); assert.doesNotMatch(JSON.stringify(preview), /codemPreview/)
    const large = Buffer.alloc(1024 * 1024); Buffer.from([137,80,78,71,13,10,26,10]).copy(large)
    await writeFile(path, large)
    assert.equal((await attachmentPreview({ kind: "image", path })).kind, "image")
    await writeFile(path, '<svg onload="alert(1)"/>')
    assert.equal((await attachmentPreview({ kind: "image", path })).kind, "unavailable")
    await writeFile(path, Buffer.alloc(20 * 1024 * 1024 + 1))
    assert.equal((await attachmentPreview({ kind: "image", path })).kind, "unavailable")
    assert.deepEqual(await attachmentPreview({ kind: "file", path: "/not-read" }), { kind: "none" })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
