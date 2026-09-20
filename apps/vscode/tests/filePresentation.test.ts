import assert from "node:assert/strict"
import { it } from "node:test"
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { changedFilePath, diffText, displayPath, validateAttachment } from "../src/resources/filePresentation.ts"
import { parseMcpConfiguration } from "../src/connection/mcpConfiguration.ts"
import type { AppServerFileDiff } from "@codem/app-server"

it("permits workspace files but rejects traversal, directories, missing files and symlink escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codemFiles"))
  try {
    const workspace = join(root, "workspace")
    await mkdir(workspace); await writeFile(join(workspace, "a.ts"), "hello"); await writeFile(join(root, "secret"), "private")
    await symlink(join(root, "secret"), join(workspace, "link"))
    assert.match(await changedFilePath(workspace, "a.ts"), /a\.ts$/)
    for (const path of ["../secret", "link", "missing", "."]) await assert.rejects(changedFilePath(workspace, path))
    assert.equal(displayPath(workspace, join(root, "secret")), "secret")
    await validateAttachment({ kind: "file", path: join(workspace, "a.ts") })
    await validateAttachment({ kind: "directory", path: workspace })
    await assert.rejects(validateAttachment({ kind: "file", path: workspace }))
    await assert.rejects(validateAttachment({ kind: "file", path: "relative.ts" }))
  } finally { await rm(root, { recursive: true, force: true }) }
})

it("keeps patch coordinates and explicitly distinguishes complete, partial, binary and omitted previews", () => {
  const base: AppServerFileDiff = { source: { kind: "tool", toolCallId: "call" }, path: "/private/file.ts", changeType: "modified", stats: { linesAdded: 1, linesRemoved: 1 }, preview: { kind: "complete", hunks: [{ oldStart: 20, oldCount: 1, newStart: 20, newCount: 1, lines: [{ kind: "delete", oldLine: 20, newLine: null, text: "before" }, { kind: "insert", oldLine: null, newLine: 20, text: "after" }] }] } }
  const complete = diffText(base, "file.ts")
  assert.match(complete, /@@ -20,1 \+20,1 @@\n-before\n\+after/)
  assert.doesNotMatch(complete, /\/private/)
  for (const [preview, expected] of [[{ kind: "partial", hunks: [] }, /截断/], [{ kind: "raw-partial", text: "+partial" }, /部分差异/], [{ kind: "binary" }, /二进制/], [{ kind: "omitted" }, /未提供/]] as const) assert.match(diffText({ ...base, preview }, "file.ts"), expected)
})

it("rejects malformed persisted MCP records and never coerces unsupported transports or duplicate names", () => {
  const server = { type: "stdio", name: "fixture", command: "/usr/bin/node", args: ["server.js"], env: [{ name: "API_KEY", value: "secret" }] }
  assert.deepEqual(parseMcpConfiguration({ servers: [server], enabled: ["fixture"] }), { servers: [server], enabled: ["fixture"] })
  for (const value of [null, { servers: [], enabled: ["missing"] }, { servers: [server, server], enabled: [] }, { servers: [{ ...server, type: "http" }], enabled: [] }, { servers: [{ ...server, command: "node" }], enabled: [] }, { servers: [{ ...server, env: [{ name: "A", value: 1 }] }], enabled: [] }, { servers: [{ ...server, args: [1] }], enabled: [] }, { servers: [server], enabled: ["fixture", "fixture"] }]) assert.throws(() => parseMcpConfiguration(value))
})
