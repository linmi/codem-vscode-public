import assert from "node:assert/strict"
import { it } from "node:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readSessionImage } from "../src/index.ts"
import { projectHashForCwd } from "../src/shared/cli-adapter/records/cwd.ts"

it("reads bounded session images only with matching hash and confined paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemSessionImage"))
  try {
    const directory = join(root, projectHashForCwd("/workspace"), "thread1", "attachments")
    await mkdir(directory, { recursive: true })
    const bytes = Buffer.from([137,80,78,71,13,10,26,10])
    await writeFile(join(directory, "image.png"), bytes)
    const attachment = { kind: "session-image" as const, path: "attachments/image.png", sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "image/png" as const, width: 1, height: 1, sizeBytes: bytes.length, displayName: "image.png" }
    const options = { sessionsRoot: root, cwd: "/workspace", threadId: "thread1", attachment }
    assert.deepEqual(await readSessionImage(options), bytes)
    await assert.rejects(readSessionImage({ ...options, threadId: "other" }))
    await assert.rejects(readSessionImage({ ...options, attachment: { ...attachment, path: "attachments/../../escape" } }))
    await assert.rejects(readSessionImage({ ...options, attachment: { ...attachment, sha256: "0".repeat(64) } }))
    await rm(join(directory, "image.png")); await symlink(join(root, "outside"), join(directory, "image.png")); await writeFile(join(root, "outside"), bytes)
    await assert.rejects(readSessionImage(options))
  } finally { await rm(root, { recursive: true, force: true }) }
})
