import assert from "node:assert/strict"
import { it } from "node:test"
import { realpath, mkdtemp, writeFile, symlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FileReferences } from "../src/fileReferences.ts"
import { parseViewAction } from "../src/messages.ts"

it("confines file references to current workspace and rejects stale, forged and escaping handles", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemReferences"))
  const outside = await mkdtemp(join(tmpdir(), "codemOutside"))
  try {
    await writeFile(join(root, "hello.ts"), "hello")
    await writeFile(join(outside, "secret"), "private")
    await symlink(join(outside, "secret"), join(root, "escape"))
    const references = new FileReferences()
    const files = await references.search(root, "", async () => [join(root, "hello.ts"), join(root, "escape")])
    assert.equal(files.length, 1); assert.equal(files[0]!.label, "hello.ts")
    assert.doesNotMatch(JSON.stringify(files), new RegExp(root))
    assert.equal((await references.resolve(root, files[0]!.id)).path, await realpath(join(root, "hello.ts")))
    await assert.rejects(references.resolve(outside, files[0]!.id))
    await assert.rejects(references.resolve(root, "forged"))
    references.clear(); await assert.rejects(references.resolve(root, files[0]!.id))
    let finish!: (paths: string[]) => void
    const first = references.search(root, "old", () => new Promise(resolve => { finish = resolve }))
    await references.search(root, "new", async () => [])
    finish([join(root, "hello.ts")]); assert.deepEqual(await first, [])
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})
it("accepts bounded search intent, rejects paths in selection and malformed input", () => {
  assert.deepEqual(parseViewAction({ type: "searchFiles", query: "main", requestId: "r" }), { type: "searchFiles", query: "main", requestId: "r" })
  for (const action of [{ type: "searchFiles", query: "x".repeat(201), requestId: "r" }, { type: "selectFile", id: "/etc/passwd", requestId: "r" }, { type: "searchFiles", query: "a\nb", requestId: "r" }]) assert.throws(() => parseViewAction(action))
})
