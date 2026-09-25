import assert from "node:assert/strict"
import { it } from "node:test"
import { ChatSettings, type SettingsConnection } from "../src/chat/chatSettings.ts"
import { ConnectionPreferences } from "../src/connection/connectionPreferences.ts"
import { UserVisibleError } from "../src/shared/userVisibleError.ts"

const spaces = [{ projectKey: "first", displayName: "第一空间" }, { projectKey: "second", displayName: "第二空间" }]
const models = [{ id: "core-model", source: "fixture", contextWindowTokens: 10000, supportsVision: true }, { id: "other-model", source: "fixture", contextWindowTokens: 20000, supportsVision: false }]
const normal = { revision: 1, permissionEpoch: 1, permissionMode: "default", workMode: "normal" } as const

function connection(key = "first"): SettingsConnection {
  return { cwd: "/workspace", space: { key }, model: "core-model", models, mcpServers: [] }
}

/** A workspaceState stand-in; `fail` makes the next writes of a key throw. */
function store() {
  const data = new Map<string, unknown>()
  const failing = new Set<string>()
  const writes: string[] = []
  const preferences = new ConnectionPreferences({
    get: <T>(key: string) => data.get(key) as T | undefined,
    update: async (key, value) => { writes.push(key); if (failing.has(key) || failing.has("*")) throw new Error("disk full"); data.set(key, value) },
  })
  return { preferences, writes, fail: (key = "*") => failing.add(key), heal: () => failing.clear() }
}

function owner(preferences?: ConnectionPreferences) {
  const reports: string[] = []
  return { settings: new ChatSettings({ preferences, report: operation => reports.push(operation) }), reports }
}

it("first use: offline choices publish only the fixed values, persist without a connection and survive a reload", async () => {
  const s = store()
  const { settings } = owner(s.preferences)
  assert.deepEqual(settings.choices(), { effort: "medium", permission: "default", workMode: "default" })
  assert.deepEqual(settings.catalog(), { models: [], spaces: [] })
  assert.equal(settings.catalogModel("anything"), undefined)
  assert.deepEqual(settings.chooseOffline({ intelligence: "high" }), { effort: "high", permission: "default", workMode: "default" })
  assert.equal(await settings.savePending(), null)
  assert.deepEqual(s.preferences.pendingSettings(), { intelligence: "high" })
  const reloaded = owner(s.preferences).settings
  assert.deepEqual(reloaded.choices(), { effort: "high", permission: "default", workMode: "default" })
  const draft = reloaded.draft() as { intelligence: string }
  draft.intelligence = "low"
  assert.equal(reloaded.current().intelligence, "high", "a picker's draft is a private copy")
})

it("repeated changes accumulate, an unchanged choice needs no write, and review asks Core only for what changed", async () => {
  const { settings } = owner(store().preferences)
  settings.chooseOffline({ intelligence: "high" })
  settings.chooseOffline({ workMode: "plan" })
  assert.equal(settings.unchanged({ intelligence: "high", workMode: "plan" }), true)
  assert.equal(settings.unchanged({ intelligence: "low" }), false)
  settings.bind(connection(), await settings.restore(connection()), spaces)
  const current = settings.current()
  assert.equal(current.workMode, "plan")
  assert.deepEqual(settings.review(current, { ...normal, workMode: "plan" }), { resume: false, modes: null })
  assert.deepEqual(settings.review({ ...current, intelligence: "low" }, { ...normal, workMode: "plan" }), { resume: true, modes: null })
  assert.deepEqual(settings.review({ ...current, workMode: "default", permissionMode: "auto" }, { ...normal, workMode: "plan" }), { resume: false, modes: { permissionMode: "auto", workMode: "normal" } })
  assert.deepEqual(settings.review({ ...current, workMode: "default" }, null), { resume: false, modes: null }, "without a thread there is nothing to write")
  assert.equal(settings.acceptModes({ permissionMode: "auto", workMode: "normal" }).workMode, "default")
  assert.equal(settings.acceptModes({ permissionMode: "auto", workMode: "plan" }).workMode, "plan")
  const committed = settings.commit({ ...settings.current(), model: "other-model", permissionMode: "yolo" }, { ...normal, permissionMode: "auto" })
  assert.deepEqual(committed, { model: "other-model", effort: "high", permission: "auto", workMode: "default", mcpNames: [] }, "Core's confirmed modes win over the requested ones")
})

it("failure: rejects choices outside the catalog, and failed writes keep the choice in effect and pending for the next attempt", async () => {
  const s = store()
  const { settings, reports } = owner(s.preferences)
  assert.throws(() => settings.review(settings.current(), null), UserVisibleError, "an unbound owner has no catalog to accept from")
  s.fail("codem.pendingEffort")
  settings.chooseOffline({ intelligence: "xhigh" })
  assert.match((await settings.savePending())!, /保存失败/)
  assert.equal(settings.choices().effort, "xhigh")
  s.heal(); await settings.savePending()
  s.fail()
  const restored = await settings.restore(connection())
  assert.equal(restored.settings.intelligence, "xhigh")
  assert.match(restored.notice!, /下次连接会继续尝试保存/)
  assert.equal(s.preferences.pendingSettings().intelligence, "xhigh", "a failed promotion keeps the offline choice")
  settings.bind(connection(), restored, spaces)
  assert.throws(() => settings.review({ ...settings.current(), model: "invented" }, null), /不在 Core 支持的列表中/)
  assert.throws(() => settings.review({ ...settings.current(), intelligence: "max" }, null), /不在 Core 支持的列表中/)
  settings.commit({ ...settings.current(), intelligence: "low" }, null)
  assert.match((await settings.persist())!, /配置已应用，但保存失败/)
  assert.equal(settings.current().intelligence, "low", "the applied choice stays visible")
  s.heal()
  assert.equal(await settings.persist(), null)
  assert.deepEqual(s.preferences.pendingSettings(), {}, "the retry promotes the newer connected choice, then clears it")
  assert.equal((await s.preferences.load(connection()))?.intelligence, "low")
  assert.deepEqual(reports, ["saveSettings", "saveSettings", "saveSettings"])
})

it("reload restore: the scope's saved settings return, and an unavailable saved model falls back without overwriting the preference", async () => {
  const s = store()
  await s.preferences.save(connection(), { model: "other-model", intelligence: "high", permissionMode: "auto", workMode: "plan" })
  const first = owner(s.preferences).settings
  const restored = await first.restore(connection())
  assert.equal(restored.notice, null)
  assert.deepEqual(first.bind(connection(), restored, spaces), { model: "other-model", effort: "high", permission: "auto", workMode: "plan", mcpNames: [] })
  assert.deepEqual(first.catalog().models.map(model => model.selected), [false, true])
  await s.preferences.save(connection(), { model: "removed-model", intelligence: "low", permissionMode: "default", workMode: "default" })
  const writes = s.writes.length
  const second = owner(s.preferences).settings
  const fallback = await second.restore(connection())
  assert.equal(fallback.settings.model, "core-model")
  assert.equal(fallback.settings.intelligence, "low")
  assert.match(fallback.notice!, /已保存的模型当前不可用/)
  assert.equal(s.writes.length, writes, "reading back never rewrites the preference")
  assert.equal((await s.preferences.load(connection()))?.model, "removed-model")
})

it("context switch: each scope reads its own settings, consumed offline choices do not follow, and old handles stop resolving", async () => {
  const s = store()
  await s.preferences.save(connection("second"), { model: "core-model", intelligence: "medium", permissionMode: "auto", workMode: "default" })
  const { settings } = owner(s.preferences)
  settings.chooseOffline({ intelligence: "xhigh" }); await settings.savePending()
  settings.bind(connection(), await settings.restore(connection()), spaces)
  assert.equal(settings.current().intelligence, "xhigh")
  assert.deepEqual(s.preferences.pendingSettings(), {})
  assert.equal((await s.preferences.load(connection()))?.intelligence, "xhigh")
  const oldModel = settings.catalog().models[1]!.id, oldSpace = settings.catalog().spaces[1]!.id
  assert.equal(settings.catalogModel(oldModel), "other-model")
  assert.equal(settings.catalogSpace(oldSpace), "second")
  const abandoned = await settings.restore(connection("second"))
  assert.equal(abandoned.settings.intelligence, "medium")
  assert.equal(settings.current().intelligence, "xhigh", "reading another scope binds nothing")
  settings.unbind()
  assert.deepEqual(settings.catalog(), { models: [], spaces: [] })
  assert.equal(settings.catalogModel(oldModel), undefined)
  assert.equal(settings.current().intelligence, "xhigh", "settings stay until the next binding replaces them")
  settings.bind(connection("second"), await settings.restore(connection("second")), spaces)
  assert.deepEqual(settings.choices(), { effort: "medium", permission: "auto", workMode: "default" })
  assert.equal(settings.catalogSpace(oldSpace), undefined, "a new binding issues new handles")
  assert.deepEqual(settings.catalog().spaces.map(space => space.selected), [false, true])
  settings.chooseOffline({ permissionMode: "yolo" })
  assert.deepEqual(settings.reset(), { model: "codem-router/auto", effort: "medium", permission: "yolo", workMode: "default", mcpNames: [] }, "an account reset keeps only offline choices")
  assert.deepEqual(settings.catalog(), { models: [], spaces: [] })
})
