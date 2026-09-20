import assert from "node:assert/strict"
import { it } from "node:test"
import { ConnectionPreferences, parseSavedSettings } from "../src/connection/connectionPreferences.ts"

it("persists only non-secret settings and isolates workspace and space", async () => {
  const data = new Map<string, unknown>()
  const store = { get: <T>(key: string) => data.get(key) as T | undefined, update: async (key: string, value: unknown) => { data.set(key, value) } }
  const first = new ConnectionPreferences(store)
  const scope = { cwd: "/work/a", space: { key: "team" } }
  const settings = { model: "model", intelligence: "high", permissionMode: "yolo" as const, workMode: "plan" as const, mcpServers: [{ env: "secret" }] }
  await first.save(scope, settings)
  await first.remember({ cwd: scope.cwd, workspace: "a", key: "team" })
  const reopened = new ConnectionPreferences(store)
  assert.deepEqual(await reopened.load(scope), { model: "model", intelligence: "high", permissionMode: "yolo", workMode: "plan" })
  assert.equal(await reopened.load({ ...scope, cwd: "/work/b" }), null)
  assert.equal(await reopened.load({ ...scope, space: { key: "personal" } }), null)
  assert.equal(reopened.lastConnection()?.key, "team")
  assert.equal(JSON.stringify([...data.values()]).includes("secret"), false)
})
it("rejects invalid saved settings instead of silently accepting unsupported values", () => {
  const valid = { model: "model", intelligence: "medium", permissionMode: "default", workMode: "default" }
  for (const value of [null, {}, { ...valid, intelligence: "max" }, { ...valid, permissionMode: "all" }, { ...valid, token: "secret" }]) assert.throws(() => parseSavedSettings(value))
})
