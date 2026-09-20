import assert from "node:assert/strict"
import { it } from "node:test"
import { ActiveConversation } from "../src/sessionHistory/activeConversation.ts"

const scope = { cwd: "/workspace", spaceKey: "team", accountKey: "account" }
function fixture() {
  const data = new Map<string, unknown>()
  const store = { get: <T>(key: string) => data.get(key) as T | undefined, update: async (key: string, value: unknown) => { data.set(key, value) } }
  return { data, store, active: new ActiveConversation(store) }
}

it("persists only the selected identity, isolated by workspace, account and space", async () => {
  const f = fixture()
  await f.active.save(scope, "core-thread")
  const reopened = new ActiveConversation(f.store)
  assert.equal(await reopened.load(scope), "core-thread")
  for (const other of [{ ...scope, cwd: "/other" }, { ...scope, accountKey: "different-account" }, { ...scope, spaceKey: "other-space" }]) assert.equal(await reopened.load(other), null)
  assert.deepEqual([...f.data.values()], ["core-thread"])
  assert.match([...f.data.keys()][0]!, /^codem\.activeConversation\.[a-f0-9]{64}$/)
  await reopened.save(scope, null)
  assert.equal(await new ActiveConversation(f.store).load(scope), null)
})

it("serializes writes and clearing, and flush waits for durable completion", async () => {
  const f = fixture()
  let finish!: () => void
  let started!: () => void
  const writing = new Promise<void>(resolve => { started = resolve })
  const update = f.store.update
  f.store.update = async (key, value) => {
    if (value === "old") { started(); await new Promise<void>(resolve => { finish = resolve }) }
    await update(key, value)
  }
  const old = f.active.save(scope, "old")
  await writing
  const clear = f.active.save(scope, null)
  const next = f.active.save(scope, "new")
  let flushed = false
  const flush = f.active.flush().then(() => { flushed = true })
  await Promise.resolve()
  assert.equal(flushed, false)
  finish(); await Promise.all([old, clear, next, flush])
  assert.equal(await f.active.load(scope), "new")
})

it("reports failed writes without poisoning later saves", async () => {
  const f = fixture(), update = f.store.update
  f.store.update = async () => { throw new Error("storage failed") }
  await assert.rejects(f.active.save(scope, "old"), /storage failed/)
  f.store.update = update
  await f.active.save(scope, "new")
  assert.equal(await f.active.load(scope), "new")
})

it("rejects corrupt bookmarks and incomplete account scopes before any history operation", async () => {
  const f = fixture()
  await f.active.save(scope, "valid")
  const key = [...f.data.keys()][0]!
  for (const invalid of [null, {}, "", " ../other", "../other", ".", "..", "a\\b", "a\n"]) {
    f.data.set(key, invalid)
    await assert.rejects(f.active.load(scope), /Invalid saved Core thread identity/)
  }
  await assert.rejects(f.active.load({ ...scope, accountKey: null }), /authenticated account/)
  await assert.rejects(f.active.save({ ...scope, accountKey: null }, "thread"), /authenticated account/)
})
