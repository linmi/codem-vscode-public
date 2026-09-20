import assert from "node:assert/strict"
import { it } from "node:test"
import { PanelBroker } from "../src/panelBroker.ts"
import type { PanelMessage, PanelView } from "../src/panelTypes.ts"
import { parseViewAction } from "../src/messages.ts"
import { selectSettings } from "../src/settingsPanels.ts"
import { showInteraction } from "../src/interactions.ts"

function fixture() {
  const broker = new PanelBroker(); const owner = {}; const messages: PanelMessage[] = []
  broker.bind(owner, message => messages.push(message))
  const view = (): PanelView => { const value = messages.at(-1)?.panel; assert.ok(value); return value }
  const reply = (ids: string[], text = "") => ({ type: "panelReply" as const, id: view().id, choiceIds: ids, text, cancelled: false })
  return { broker, owner, messages, view, reply }
}

it("accepts exactly a bounded panel reply, rejecting raw RPC, duplicate choices and extra fields", () => {
  const reply = { type: "panelReply", id: "request", choiceIds: ["choice"], text: "", cancelled: false }
  assert.deepEqual(parseViewAction(reply), reply)
  for (const invalid of [{ ...reply, requestId: "core" }, { ...reply, choiceIds: ["choice", "choice"] }, { ...reply, choiceIds: ["../file"] }, { ...reply, text: "x".repeat(16001) }, { ...reply, cancelled: true }, { ...reply, choiceIds: [] , cancelled: "true" }]) assert.throws(() => parseViewAction(invalid))
})

it("binds decisions to the live view and opaque choices, consuming each request once", async () => {
  const f = fixture()
  const result = f.broker.request({ kind: "approval", title: "Approve", choices: [{ label: "Allow once", value: "CORE_OPTION" }] })
  const panel = f.view(); const reply = f.reply([panel.choices[0]!.id])
  assert.ok(!JSON.stringify(panel).includes("CORE_OPTION"))
  f.broker.answer({}, reply); assert.equal(f.view().id, panel.id)
  f.broker.answer(f.owner, { ...reply, id: "stale" }); assert.equal(f.view().id, panel.id)
  f.broker.answer(f.owner, { ...reply, choiceIds: ["forged"] }); assert.equal(f.view().id, panel.id)
  f.broker.answer(f.owner, { ...reply, text: "injected" }); assert.equal(f.view().id, panel.id)
  f.broker.answer(f.owner, reply)
  assert.deepEqual(await result, { values: ["CORE_OPTION"], text: "" })
  f.broker.answer(f.owner, reply); assert.equal(f.messages.at(-1)?.panel, null)
})

it("retires requests on abort, supersession and view disposal; old views cannot close replacements", async () => {
  const f = fixture(); const abort = new AbortController()
  const first = f.broker.request({ kind: "model", title: "Model", choices: [{ label: "A", value: "a" }] }, abort.signal)
  const stale = f.reply([f.view().choices[0]!.id]); abort.abort(); assert.equal(await first, null)
  const second = f.broker.request({ kind: "model", title: "Model", choices: [] })
  f.broker.answer(f.owner, stale); assert.ok(f.view())
  const third = f.broker.request({ kind: "question", title: "Question", choices: [], allowText: true, confirmLabel: "Submit" })
  assert.equal(await second, null)
  f.broker.unbind(f.owner); assert.equal(await third, null)
  const nextOwner = {}; f.broker.bind(nextOwner, message => f.messages.push(message))
  const fourth = f.broker.request({ kind: "model", title: "Model", choices: [{ label: "B", value: "b" }] })
  f.broker.unbind(f.owner); assert.ok(f.view())
  f.broker.answer(nextOwner, f.reply([f.view().choices[0]!.id])); assert.deepEqual(await fourth, { values: ["b"], text: "" })
})

it("validates single/multiple selection and allows text-only questions without empty submissions", async () => {
  const f = fixture()
  const result = f.broker.request({ kind: "question", title: "Question", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }], allowText: true, confirmLabel: "Submit" })
  f.broker.answer(f.owner, f.reply([])); assert.ok(f.view())
  f.broker.answer(f.owner, f.reply(f.view().choices.map(c => c.id))); assert.ok(f.view())
  f.broker.answer(f.owner, f.reply([], " Other answer "))
  assert.deepEqual(await result, { values: [], text: "Other answer" })
  const multi = f.broker.request({ kind: "question", title: "Multiple", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }], multiple: true, confirmLabel: "Submit" })
  f.broker.answer(f.owner, f.reply(f.view().choices.map(c => c.id)))
  assert.deepEqual(await multi, { values: ["a", "b"], text: "" })
})

it("projects permission previews without Core identifiers or file handles and returns only offered options", async () => {
  const f = fixture(); const abort = new AbortController()
  const result = showInteraction({ kind: "permission", requestId: "secretCoreRequest", threadId: "coreThread", turnId: "coreTurn", toolCallId: "coreCall", toolName: "write_file", reason: "Write file", options: [{ id: "allow_once", label: "Allow once" }], preview: { kind: "file_write", path: "/workspace/src/a.ts", changeSummary: "new file", diffExcerpt: "+export {}", rootSuggestion: null } }, abort.signal, f.broker, "/workspace")
  assert.equal(f.view().detail, "src/a.ts\n+export {}")
  assert.doesNotMatch(JSON.stringify(f.view()), /secretCoreRequest|coreThread|coreTurn|coreCall|allow_once|\/workspace/)
  f.broker.answer(f.owner, f.reply([f.view().choices[0]!.id]))
  assert.deepEqual(await result, { kind: "permission", optionId: "allow_once" })
})

it("serializes question cards and cancels later questions when the turn ends", async () => {
  const f = fixture(); const abort = new AbortController()
  const result = showInteraction({ kind: "question", requestId: "r", threadId: "t", turnId: "u", questions: [1, 2].map(i => ({ id: String(i), header: "Question", question: `Question ${i}`, allowsMultipleSelection: false, options: [{ label: "A", description: "Option A", preview: null }] })) }, abort.signal, f.broker, "/workspace")
  assert.equal(f.view().title, "Question · 1/2")
  f.broker.answer(f.owner, f.reply([f.view().choices[0]!.id]))
  await Promise.resolve(); assert.equal(f.view().title, "Question · 2/2")
  abort.abort(); assert.deepEqual(await result, { kind: "question", cancelled: true })
  assert.equal(f.messages.at(-1)?.panel, null)
})


it("selects effort independently and preserves model settings on selection and cancellation", async () => {
  const f = fixture()
  const settings = { model: "auto", intelligence: "medium" as const, permissionMode: "default" as const, workMode: "default" as const, mcpServers: [], additionalDirectories: [] }
  const session = { models: [{ id: "auto", source: "fixture", contextWindowTokens: 10000, supportsVision: false }] }
  const abort = new AbortController()
  const result = selectSettings("selectEffort", settings, session, f.broker, abort.signal)
  assert.equal(f.view().kind, "effort")
  assert.deepEqual(f.view().choices.map(c => c.label), ["low", "medium", "high", "xhigh"])
  assert.equal(f.view().choices[1]!.description, "默认")
  assert.equal(f.view().choices[1]!.selected, true)
  f.broker.answer(f.owner, f.reply([f.view().choices.find(c => c.label === "xhigh")!.id]))
  assert.deepEqual(await result, { ...settings, intelligence: "xhigh" })
  const model = selectSettings("selectModel", settings, session, f.broker, abort.signal)
  assert.equal(f.view().choices.length, 1)
  f.broker.answer(f.owner, f.reply([f.view().choices[0]!.id]))
  assert.deepEqual(await model, settings)
  const cancelled = selectSettings("selectEffort", settings, session, f.broker, abort.signal)
  abort.abort()
  assert.equal(await cancelled, null)
  assert.equal(settings.intelligence, "medium")
  assert.deepEqual(parseViewAction({ type: "selectEffort" }), { type: "selectEffort" })
  assert.throws(() => parseViewAction({ type: "selectEffort", effort: "injected" }))
})

it("restores an earlier question answer and rejects a mixed back/answer submission", async () => {
  const f = fixture(); const abort = new AbortController()
  const result = showInteraction({ kind: "question", requestId: "r", threadId: "t", turnId: "u", questions: [1, 2].map(i => ({ id: String(i), header: "Question", question: `Question ${i}`, allowsMultipleSelection: false, options: [{ label: "A", description: "Option A", preview: null }] })) }, abort.signal, f.broker, "/workspace")
  f.broker.answer(f.owner, f.reply([f.view().choices[0]!.id], "first note")); await Promise.resolve()
  const second = f.view()
  assert.ok(second.backChoiceId)
  f.broker.answer(f.owner, f.reply([second.backChoiceId, second.choices[0]!.id])); assert.equal(f.view().id, second.id)
  f.broker.answer(f.owner, f.reply([second.backChoiceId])); await Promise.resolve()
  assert.equal(f.view().title, "Question · 1/2")
  assert.equal(f.view().initialText, "first note"); assert.equal(f.view().choices[0]!.selected, true)
  abort.abort(); assert.deepEqual(await result, { kind: "question", cancelled: true })
})

it("sends plan revision feedback only on an explicit rejection", async () => {
  const f = fixture()
  const result = showInteraction({ kind: "plan", requestId: "r", threadId: "t", turnId: "u", plan: "Plan" }, new AbortController().signal, f.broker, "/workspace")
  f.broker.answer(f.owner, f.reply([f.view().choices[1]!.id], "Add validation"))
  assert.deepEqual(await result, { kind: "plan", approved: false, feedback: "Add validation" })
})


it("rewind maps opaque checkpoint and scope choices, with cancellation at either stage", async () => {
  for (const cancelAt of [0, 1, 2]) {
    const f = fixture(), abort = new AbortController()
    const result = showInteraction({ kind: "rewind", requestId: "core-request", threadId: "core-thread", turnId: "core-turn", checkpoints: [{ id: "core-checkpoint", label: "发送前", createdAt: null, fileCount: 1, diffExcerpt: null, warning: null }], modes: ["conversation", "both"] }, abort.signal, f.broker, "/workspace")
    assert.equal(f.view().kind, "rewind")
    assert.doesNotMatch(JSON.stringify(f.view()), /core-checkpoint|core-request/)
    if (cancelAt === 1) abort.abort()
    else {
      f.broker.answer(f.owner, f.reply([f.view().choices[0]!.id]))
      await Promise.resolve()
      assert.equal(f.view().title, "确认回退范围")
      if (cancelAt === 2) abort.abort()
      else f.broker.answer(f.owner, f.reply([f.view().choices[0]!.id]))
    }
    assert.deepEqual(await result, cancelAt ? { kind: "rewind", cancelled: true } : { kind: "rewind", cancelled: false, checkpointId: "core-checkpoint", mode: "conversation" })
  }
})
