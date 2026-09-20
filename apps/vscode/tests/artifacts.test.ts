import assert from "node:assert/strict"
import { it } from "node:test"
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Artifacts } from "../src/resources/artifacts.ts"
import { projectToolDetails } from "../src/chat/toolDetails.ts"

it("projects dedicated tool fields without serializing unknown arguments or credentials", () => {
  const command = projectToolDetails("run_bash", { command: "TOKEN=private echo done", env: { SECRET: "secret" } }, "/workspace")
  assert.match(command!.code!, /已隐藏/); assert.doesNotMatch(JSON.stringify(command), /private|secret|SECRET/)
  assert.equal(projectToolDetails("unknown", { secret: "value" }, "/workspace"), null)
  assert.equal(projectToolDetails("read_files", { files: [{ path: "/workspace/src/main.ts" }, { path: "/private/outside" }] }, "/workspace")!.fields[0]!.value, "src/main.ts")
  assert.deepEqual(projectToolDetails("web_fetch", { url: "javascript:alert(1)" }, "/workspace")!.fields, [])
  assert.doesNotMatch(JSON.stringify(projectToolDetails("mcp__test__echo", { token: "secret" }, "/workspace")), /secret/)
})
it("artifact handles reject forged ids, escaped paths and active URLs", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "codemArtifacts")))
  try {
    await writeFile(join(root, "report.txt"), "report")
    const artifacts = new Artifacts()
    const cards = artifacts.project([
      { kind: "file", title: "Report", path: "report.txt" },
      { kind: "url", title: "Bad", uri: "javascript:alert(1)" },
      { kind: "url", title: "Credential", uri: "https://user:secret@example.com" },
      { kind: "chart", title: "Chart", spec: { data: [1, 2] } },
      { kind: "file", title: "Escape", path: "/etc/passwd" },
    ], root)
    assert.doesNotMatch(JSON.stringify(cards), /javascript|secret|\/etc\/passwd/)
    assert.equal(cards[1]!.available, false); assert.equal(cards[2]!.available, false)
    assert.deepEqual(await artifacts.resolve(root, cards[0]!.id), { kind: "file", path: join(root, "report.txt") })
    assert.equal((await artifacts.resolve(root, cards[3]!.id)).kind, "chart")
    await assert.rejects(artifacts.resolve(root, cards[4]!.id)); await assert.rejects(artifacts.resolve(root, "forged"))
    artifacts.clear(); await assert.rejects(artifacts.resolve(root, cards[0]!.id))
  } finally { await rm(root, { recursive: true, force: true }) }
})
