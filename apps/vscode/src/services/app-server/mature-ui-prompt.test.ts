import assert from "node:assert/strict"
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, it } from "node:test"
import { prepareMatureUiPrompt } from "./mature-ui-prompt.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("prepareMatureUiPrompt", () => {
  it("maps only real workspace files into strict App Server attachments", async () => {
    const root = await temporaryDirectory()
    const nested = path.join(root, "src")
    const file = path.join(nested, "index.ts")
    await mkdir(nested)
    await writeFile(file, "export {}\n")
    const canonicalFile = await realpath(file)

    assert.deepEqual(
      await prepareMatureUiPrompt(
        {
          type: "sendMessage",
          text: "Review this",
          files: [{ mime: "text/typescript", url: pathToFileURL(file).toString(), filename: "index.ts" }],
        },
        root,
      ),
      { text: "Review this", attachments: [{ kind: "file", path: canonicalFile }] },
    )
  })

  it("rejects files outside the active workspace", async () => {
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    const file = path.join(outside, "secret.txt")
    await writeFile(file, "secret\n")

    await assert.rejects(
      prepareMatureUiPrompt(
        {
          type: "sendMessage",
          text: "Read this",
          files: [{ mime: "text/plain", url: pathToFileURL(file).toString(), filename: "secret.txt" }],
        },
        root,
      ),
      /outside the active workspace/u,
    )
  })

  it("fails explicitly for attachment forms that Core cannot consume", async () => {
    const root = await temporaryDirectory()
    await assert.rejects(
      prepareMatureUiPrompt(
        {
          type: "sendMessage",
          text: "Inspect image",
          files: [{ mime: "image/png", url: "data:image/png;base64,AA==" }],
        },
        root,
      ),
      /cannot send pasted attachments/u,
    )
  })
})

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "codem-prompt-"))
  roots.push(root)
  return root
}
