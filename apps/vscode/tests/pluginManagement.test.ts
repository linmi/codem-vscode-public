import assert from "node:assert/strict"
import { it } from "node:test"
import { PluginManagement, type PluginManagementContext } from "../src/plugins/pluginManagement.ts"
import { capabilityFixture } from "./capabilityFixtures.ts"
import type { InstalledPlugin } from "@codem/app-server"
import { PluginOperationError } from "@codem/app-server"

function fixture() {
  let entries: InstalledPlugin[] = []
  let writes = 0, reads = 0
  const accepted: unknown[] = []
  const manager = new PluginManagement(() => {}, () => {})
  const context: PluginManagementContext = {
    authorize: async () => {}, assertCurrent() {},
    skills: async () => [{ name: "sample:hello", description: "Example" }], acceptSkills: skills => accepted.push(skills),
    commands: {
      list: async () => { reads++; return structuredClone(entries) },
      install: async () => { writes++; entries = [{ key: "sample", name: "sample", version: "1.0", enabled: true, path: "/private/plugin" }]; return "sample" },
      change: async (action) => { writes++; entries = action === "uninstall" ? [] : entries.map(entry => ({ ...entry, enabled: action === "enable" })) },
    },
  }
  return { manager, context, accepted, counts: () => ({ writes, reads }) }
}
it("closes the management loop and keeps paths and registry keys in Host", async () => {
  const f = fixture()
  assert.equal(f.manager.snapshot().loaded, false)
  await f.manager.refresh(f.context)
  assert.equal(f.manager.snapshot().loaded, true)
  await f.manager.install(f.context, async () => ({ kind: "local", path: "/private/plugin" }))
  assert.equal(f.manager.snapshot().entries[0]!.enabled, true)
  assert.doesNotMatch(JSON.stringify(f.manager.snapshot()), /private|path|"key"/)
  assert.equal(f.manager.snapshot().skills[0]!.name, "sample:hello")
  for (const action of ["disable", "enable", "uninstall"] as const) await f.manager.change(f.context, action, f.manager.snapshot().entries[0]!.id)
  assert.deepEqual(f.manager.snapshot().entries, [])
  assert.equal(f.counts().writes, 4)
  assert.equal(f.manager.snapshot().status, "ready")
})
it("blocks repeated writes, allows closing during work, and reads back an uncertain cancellation", async () => {
  const f = fixture()
  let release!: () => void
  const real = f.context.commands.install
  f.context.commands.install = async (...args) => { await real(...args); await new Promise<void>(resolve => { release = resolve }); throw new PluginOperationError("cancelled", "cancelled after write") }
  const pending = f.manager.install(f.context, async () => ({ kind: "local", path: "/private/plugin" }))
  await new Promise(resolve => setImmediate(resolve))
  await f.manager.install(f.context, async () => { throw new Error("must not pick twice") })
  f.manager.close(); f.manager.cancel(); release(); await pending
  assert.equal(f.counts().writes, 1)
  assert.equal(f.manager.snapshot().open, false)
  assert.equal(f.manager.snapshot().entries.length, 1)
  assert.match(f.manager.snapshot().error!, /取消前可能已完成/)
})
it("cancelled picker performs no write, failed refresh remains actionable, reset discards late results", async () => {
  const f = fixture()
  await f.manager.install(f.context, async () => null)
  assert.equal(f.counts().writes, 0)
  f.context.commands.list = async () => { throw new Error("malformed") }
  await f.manager.refresh(f.context)
  assert.equal(f.manager.snapshot().status, "error")
  let finish!: () => void
  f.context.commands.list = async () => { await new Promise<void>(resolve => { finish = resolve }); return [] }
  const loading = f.manager.refresh(f.context)
  await new Promise(resolve => setImmediate(resolve))
  const closing = f.manager.reset(); finish(); await Promise.all([loading, closing])
  assert.equal(f.manager.snapshot().open, false)
  assert.equal(f.manager.snapshot().loaded, false)
})
it("reports successful write separately when skills refresh fails and never retries the write", async () => {
  const f = fixture()
  f.context.skills = async () => { throw new Error("rpc unavailable") }
  await f.manager.install(f.context, async () => ({ kind: "marketplace", spec: "sample@local" }))
  assert.equal(f.counts().writes, 1)
  assert.equal(f.manager.snapshot().entries.length, 1)
  assert.match(f.manager.snapshot().error!, /已完成.*刷新或核验失败/)
  assert.equal(f.manager.snapshot().skills.length, 0)
})
it("reset releases a pending native picker and ignores its late selection", async () => {
  const f = fixture()
  let choose!: (source: { kind: "local"; path: string }) => void
  const pending = f.manager.install(f.context, () => new Promise(resolve => { choose = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  await f.manager.reset()
  await pending
  assert.equal(f.manager.busy, false)
  choose({ kind: "local", path: "/private/plugin" })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.counts().writes, 0)
  assert.equal(f.manager.snapshot().open, false)
  assert.equal(f.manager.snapshot().loaded, false)
})
it("Host serializes plugin operations with chat turns and clears selection after mutation", async () => {
  const f = capabilityFixture(), commands = fixture()
  f.session.pluginCommands = commands.context.commands
  try {
    await f.controller.connect(); await f.controller.send("hello")
    await f.controller.installPlugin(async () => ({ kind: "marketplace", spec: "sample@local" }))
    assert.equal(commands.counts().writes, 0)
    f.finish()
    let choose!: () => void
    const pending = f.controller.installPlugin(async () => { await new Promise<void>(resolve => { choose = resolve }); return { kind: "marketplace", spec: "sample@local" } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.controller.snapshot().phase, "configuring")
    assert.equal(await f.controller.send("must not race"), false)
    choose(); await pending
    assert.equal(commands.counts().writes, 1)
    assert.equal(f.controller.snapshot().phase, "ready")
    assert.equal(f.controller.snapshot().pluginManagement.entries.length, 1)
  } finally { await f.controller.dispose() }
})
