import assert from "node:assert/strict"
import { it } from "node:test"
import { initialSnapshot } from "../src/messages.ts"
import { commandUnavailable, inputUnavailable, sessionCommands, slashQuery } from "../src/sessionCommands.ts"
it("only allows steering during a live run and rejects destructive commands until idle", () => {
  const running = { ...initialSnapshot(), threadId: "thread", phase: "running" as const }
  assert.equal(commandUnavailable("steer", running), null)
  for (const id of ["clear", "delete", "compact", "rewind", "rename", "shell", "ask"] as const) assert.ok(commandUnavailable(id, running))
  for (const phase of ["stopping", "sending", "configuring", "loadingHistory", "sideQuestion", "disconnected"] as const) assert.ok(commandUnavailable("steer", { ...running, phase }))
  assert.ok(commandUnavailable("steer", { ...running, sessionTools: { ...running.sessionTools, busy: "catalog" } }))
  assert.ok(commandUnavailable("steer", { ...running, backgroundBusy: true }))
})
it("new conversations require identity for session operations, but expose read-only panels", () => {
  const state = { ...initialSnapshot(), phase: "ready" as const }
  for (const id of ["clear", "delete", "compact", "rewind", "rename", "fork", "archive", "ask", "shell"] as const) assert.ok(commandUnavailable(id, state))
  for (const id of ["skills", "catalog", "directories", "history", "files", "model", "mode", "unarchive"] as const) assert.equal(commandUnavailable(id, state), null)
  assert.equal(inputUnavailable("message", state), null)
  assert.equal(commandUnavailable("ask", { ...state, phase: "sideQuestion", sessionTools: { ...state.sessionTools, sideQuestion: { question: "q", answer: "", status: "running" } } }), null)
})
it("all command IDs are unique and slash detection never interprets normal prose as a command", () => {
  assert.equal(new Set(sessionCommands.map(command => command.id)).size, sessionCommands.length)
  assert.equal(slashQuery("/"), "")
  assert.equal(slashQuery("/compact"), "compact")
  assert.equal(slashQuery("/unknown"), "unknown")
  for (const text of ["说明 /compact", "hello", "https://example.com", "/model\n正文"]) assert.equal(slashQuery(text), null)
})


it("disconnected conversations allow first send and demand-driven entry points only", () => {
  const state = initialSnapshot()
  assert.equal(inputUnavailable("message", state), null)
  for (const id of ["files", "model", "mode", "history"] as const) assert.equal(commandUnavailable(id, state), null)
  for (const id of ["unarchive", "rename", "shell", "ask"] as const) assert.ok(commandUnavailable(id, state))
  assert.ok(inputUnavailable("message", { ...state, phase: "connecting" }))
})
