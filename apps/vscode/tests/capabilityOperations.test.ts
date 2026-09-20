import assert from "node:assert/strict"
import { it } from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { capabilityFixture } from "./capabilityFixtures.ts"
import { parseViewAction } from "../src/shared/messages.ts"

it("validates capability intents and rejects arbitrary paths and stale-shaped actions", () => {
  assert.equal(parseViewAction({ type: "loadCatalog", kind: "skills" }).type, "loadCatalog")
  for (const input of [{ type: "loadCatalog", kind: "secrets" }, { type: "steer", text: "hello", requestId: "a" }, { type: "addDirectory", path: "/etc" }, { type: "manageThread", operation: "delete", threadId: "a", name: "", requestId: "r", cwd: "/another" }]) assert.throws(() => parseViewAction(input))
})

it("steering is a single bound submission and preserves failure without automatic retry", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first")
  let calls = 0
  f.host.steerTurn = async input => { calls++; assert.equal(input.threadId, "thread-1"); assert.equal(input.submissionId, "request"); throw new Error("secret") }
  await f.controller.steer("supplement", "request")
  assert.equal(calls, 1)
  assert.equal(f.controller.snapshot().sessionTools.result?.accepted, false)
  assert.equal(f.controller.snapshot().phase, "running")
  assert.doesNotMatch(JSON.stringify(f.controller.snapshot()), /secret/)
  f.host.steerTurn = async () => { f.finish() }
  await f.controller.steer("supplement", "second")
  assert.equal(f.controller.snapshot().phase, "ready")
  assert.equal(f.controller.snapshot().messages.at(-1)?.text, "supplement")
})

it("side question has independent identity, cancellation awaits terminal, and fast completion stays terminal", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first"); f.finish()
  f.host.startSideQuestion = async (_cwd, threadId, operationId, question) => {
    f.emit({ type: "side-question-started", threadId, operationId, question, sideQuestionId: "side" })
    f.emit({ type: "side-question-delta", threadId, sideQuestionId: "wrong", delta: "foreign" })
    f.emit({ type: "side-question-delta", threadId, sideQuestionId: "side", delta: "answer " })
    return "side"
  }
  f.host.cancelSideQuestion = async () => {}
  await f.controller.askSideQuestion("question", "req")
  assert.equal(f.controller.snapshot().phase, "sideQuestion")
  assert.equal(await f.controller.send("blocked"), false)
  await f.controller.newChat()
  assert.equal(f.controller.snapshot().threadId, "thread-1")
  await f.controller.cancelSideQuestion()
  assert.equal(f.controller.snapshot().sessionTools.sideQuestion?.status, "stopping")
  assert.equal(f.controller.snapshot().phase, "sideQuestion")
  f.emit({ type: "side-question-completed", threadId: "thread-1", sideQuestionId: "side", status: "interrupted", error: null })
  assert.equal(f.controller.snapshot().phase, "ready")
  assert.equal(f.controller.snapshot().sessionTools.sideQuestion?.answer, "answer ")
  const start = f.host.startSideQuestion
  f.host.startSideQuestion = async (...args) => { const id = await start(...args); f.emit({ type: "side-question-completed", threadId: "thread-1", sideQuestionId: id, status: "completed", error: null }); return id }
  await f.controller.askSideQuestion("next", "next")
  assert.equal(f.controller.snapshot().sessionTools.sideQuestion?.status, "completed")
  assert.equal(f.controller.snapshot().phase, "ready")
})

it("control completion before RPC acknowledgement reloads durable history without reviving the turn", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first"); f.finish()
  let reads = 0
  f.session.readHistory = async () => { reads++; return { turns: [], nextCursor: null } }
  f.host.compactThread = async () => {
    f.emit({ type: "turn-started", threadId: "thread-1", turnId: "compact", submissionId: null })
    f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "compact", outcome: "completed", stopReason: "end", error: null })
    return "compact"
  }
  await f.controller.startControl("compact", "request")
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1)
  assert.equal(f.controller.snapshot().sessionTools.busy, null)
  assert.equal(f.controller.snapshot().phase, "ready")
})

it("clear consumes the new Core thread identity and refuses a thread outside the current catalog", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first"); f.finish()
  let clears = 0
  f.host.clearThread = async (_cwd, id) => { clears++; f.emit({ type: "thread-closed", cwd: "/workspace", threadId: id, reason: "thread/clear" }); return "new-thread" }
  await f.controller.manageThread("clear", "unknown", "", "bad")
  assert.equal(clears, 0)
  await f.controller.manageThread("clear", "thread-1", "", "clear")
  assert.equal(clears, 1)
  assert.equal(f.controller.snapshot().threadId, "new-thread")
  assert.deepEqual(f.controller.snapshot().messages, [])
  assert.equal(f.controller.snapshot().phase, "ready")
  assert.equal(f.controller.snapshot().sessionTools.result?.accepted, true)
})

it("skill choices use native structured input and are invalidated on skills/changed", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  f.host.listSkills = async () => [{ name: "test-skill", description: "Test" }]
  await f.controller.connect(); await f.controller.loadCatalog("skills")
  const id = f.controller.snapshot().sessionTools.skills[0]!.id
  f.controller.selectSkill("forged"); assert.equal(f.controller.snapshot().sessionTools.selectedSkill, null)
  f.controller.selectSkill(id)
  let skill: string | undefined
  const start = f.host.startTurn
  f.host.startTurn = async input => { skill = input.skillName; return start(input) }
  await f.controller.send("arguments")
  assert.equal(skill, "test-skill")
  assert.equal(f.controller.snapshot().sessionTools.selectedSkill, null)
  f.finish(); f.controller.selectSkill(id)
  f.emit({ type: "control-changed", threadId: null, method: "skills/changed" })
  assert.equal(f.controller.snapshot().sessionTools.skills.length, 0)
  assert.equal(f.controller.snapshot().sessionTools.selectedSkill, null)
})

it("a directory selection resumes once on the same thread and native cancellation does not change scope", async t => {
  const root = await mkdtemp(join(tmpdir(), "codem-directory-")); t.after(() => rm(root, { recursive: true, force: true }))
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first"); f.finish()
  const scopes: readonly string[][] = []
  f.host.resumeThread = async (_cwd, id, settings) => { assert.equal(id, "thread-1"); (scopes as string[][]).push([...settings.additionalDirectories]); f.emit({ type: "thread-closed", cwd: "/workspace", threadId: id, reason: "unsubscribed" }) }
  await f.controller.addDirectory(async () => [root, root])
  assert.equal(scopes.length, 1); assert.equal(scopes[0]?.length, 1)
  assert.equal(f.controller.snapshot().threadId, "thread-1")
  const directory = f.controller.snapshot().sessionTools.directories[0]!
  assert.ok(directory); assert.doesNotMatch(directory.label, /\//)
  await f.controller.addDirectory(async () => [])
  assert.equal(scopes.length, 1)
  await f.controller.removeDirectory(directory.id)
  assert.deepEqual(scopes[1], [])
})

it("directory reads authorize once, hide secrets and paths, and discard retired-session replies", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect()
  f.host.readConfigSnapshot = async () => ({ writable: false, writeOwner: "Core", config: { secret: "do-not-leak", shell: "/bin/zsh", active: { model: "model" } } })
  await f.controller.loadCatalog("config")
  assert.equal(f.calls.filter(call => call === "authorize").length, 1)
  assert.doesNotMatch(JSON.stringify(f.controller.snapshot()), /do-not-leak|\/bin\/zsh/)
  let done!: (value: Awaited<ReturnType<typeof f.host.readEnvironmentInfo>>) => void
  f.host.readEnvironmentInfo = () => new Promise(resolve => { done = resolve })
  const pending = f.controller.loadCatalog("environment")
  await new Promise(resolve => setImmediate(resolve))
  await f.controller.dispose()
  done({ agentName: "late", agentVersion: "1", os: "macos", arch: "arm64", cwd: "/private", shell: "/bin/zsh" })
  await pending
  assert.doesNotMatch(JSON.stringify(f.controller.snapshot()), /late|\/private/)
})


it("compaction progress never becomes a synthetic terminal; interrupted controls reload actual history", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first"); f.finish()
  let reads = 0
  f.session.readHistory = async () => { reads++; return { turns: [], nextCursor: null } }
  f.host.compactThread = async () => { f.emit({ type: "turn-started", threadId: "thread-1", turnId: "compact", submissionId: null }); return "compact" }
  await f.controller.startControl("compact", "request")
  assert.equal(f.controller.snapshot().sessionTools.busy, "compact")
  let catalogs = 0
  f.host.listSkills = async () => { catalogs++; return [] }
  await f.controller.loadCatalog("skills")
  assert.equal(catalogs, 0)
  f.emit({ type: "warning", threadId: "thread-1", message: "context compacted: replaced 2 earlier messages, kept 1" })
  assert.equal(f.controller.snapshot().phase, "running")
  assert.equal(reads, 0)
  await f.controller.stop()
  assert.equal(f.controller.snapshot().phase, "stopping")
  f.emit({ type: "turn-completed", threadId: "thread-1", turnId: "compact", outcome: "stopped", stopReason: "cancelled", error: null })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1)
  assert.equal(f.controller.snapshot().sessionTools.busy, null)
  assert.equal(f.controller.snapshot().phase, "ready")
})

it("thread mutations target verified catalog identities and do not detach after a failed archive", async t => {
  const f = capabilityFixture(); t.after(() => f.controller.dispose())
  await f.controller.connect(); await f.controller.send("first"); f.finish()
  const calls: string[] = []
  f.host.control = async (_cwd, method, params) => { calls.push(method); assert.equal(params.threadId, "thread-1"); if (method === "thread/archive") throw new Error("denied"); return method === "thread/fork" ? { threadId: "fork" } : {} }
  for (const operation of ["rename", "fork", "unarchive"] as const) {
    await f.controller.manageThread(operation, "thread-1", operation === "rename" ? "New name" : "", operation)
    assert.equal(f.controller.snapshot().sessionTools.result?.accepted, true)
  }
  await f.controller.manageThread("archive", "thread-1", "", "archive")
  assert.equal(f.controller.snapshot().sessionTools.result?.accepted, false)
  assert.equal(f.controller.snapshot().threadId, "thread-1")
  assert.equal(f.controller.snapshot().phase, "ready")
  assert.deepEqual(calls, ["thread/name/set", "thread/fork", "thread/unarchive", "thread/archive"])
})
