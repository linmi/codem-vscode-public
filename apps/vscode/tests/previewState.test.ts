import { it } from "node:test"
import assert from "node:assert/strict"
import { createPreviewState, parsePreviewSearch } from "./previewState.ts"
import { previewScenarios } from "./previewScenarios.ts"
import { catalogKinds } from "../src/shared/capabilityTypes.ts"

it("validates preview URL state and preserves existing direct fixture links", () => {
  assert.deepEqual(parsePreviewSearch({}), {scenario:"conversation",theme:"light"})
  assert.equal(createPreviewState(parsePreviewSearch({panel:"model",empty:"1"})).activePanel?.kind,"model")
  assert.throws(() => parsePreviewSearch({scenario:"missing"}), /未知预览场景/)
  assert.throws(() => parsePreviewSearch({theme:"missing"}), /未知预览主题/)
  assert.throws(() => parsePreviewSearch({panel:"toString"}), /未知预览面板/)
})

it("covers the actual tool, artifact and catalog discriminants with inspectable content", () => {
  const snapshots = previewScenarios.map(([scenario]) => createPreviewState(parsePreviewSearch({scenario})))
  const tools = snapshots.flatMap(({demo}) => demo.messages.flatMap(message => message.role === "tool" && message.details ? [message.details.kind] : []))
  assert.deepEqual([...new Set(tools)].sort(), ["command", "file", "mcp", "search", "subagent", "web"])
  const artifacts = snapshots.flatMap(({demo}) => demo.messages.flatMap(message => message.artifacts ?? []))
  assert.deepEqual([...new Set(artifacts.map(item => item.kind))].sort(), ["chart", "diff", "file", "image", "url"])
  for (const kind of ["chart", "diff", "file", "image", "url"]) {
    assert.ok(artifacts.some(item => item.kind === kind && item.available))
    assert.ok(artifacts.some(item => item.kind === kind && !item.available))
  }
  const catalogs = snapshots.flatMap(({demo}) => demo.sessionTools.catalog?.rows.length ? [demo.sessionTools.catalog.kind] : [])
  assert.deepEqual([...new Set(catalogs)].sort(), [...catalogKinds].sort())
  assert.equal(new Set(previewScenarios.map(([id]) => id)).size, previewScenarios.length)
})

it("recreates rich state and panel content independently on reset", () => {
  const first = createPreviewState(parsePreviewSearch({scenario:"catalogSkills"}))
  first.demo.sessionTools.catalog!.rows[0]!.detail = "changed"
  assert.notEqual(createPreviewState(parsePreviewSearch({scenario:"catalogSkills"})).demo.sessionTools.catalog!.rows[0]!.detail, "changed")
  const question = createPreviewState(parsePreviewSearch({scenario:"questionLong"}))
  question.activePanel!.choices[0]!.selected = false
  assert.equal(createPreviewState(parsePreviewSearch({scenario:"questionLong"})).activePanel!.choices[0]!.selected, true)
  assert.equal(createPreviewState(parsePreviewSearch({scenario:"attachmentsMany"})).demo.attachments.length, 20)
})
it("creates independent fixture state so prior choices never mutate the next scene", () => {
  const first=createPreviewState(parsePreviewSearch({scenario:"permissionYolo"}))
  first.panels.permissionMode!.choices[0]!.selected=true
  first.demo.messages=[]
  const next=createPreviewState(parsePreviewSearch({scenario:"permissionDefault"}))
  assert.equal(next.demo.permission,"default")
  assert.deepEqual(next.activePanel?.choices.filter(choice=>choice.selected).map(choice=>choice.id),["default"])
  assert.equal(createPreviewState(parsePreviewSearch({})).demo.messages.length,4)
})

it("opens effort locally without a Host panel or configuring phase", () => {
  for (const search of [{ scenario: "effort" }, { panel: "effort", empty: "1" }]) {
    const state = createPreviewState(parsePreviewSearch(search))
    assert.equal(state.surface, "effort")
    assert.equal(state.activePanel, null)
    assert.ok(["ready", "disconnected"].includes(state.demo.phase))
  }
})
