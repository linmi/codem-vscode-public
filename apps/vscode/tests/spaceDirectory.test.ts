import assert from "node:assert/strict"
import { it } from "node:test"
import { SpaceDirectory } from "../src/connection/spaceDirectory.ts"
import { fixtureIdentity, fixtureSpaces } from "./spaceFixtures.ts"
it("repeated menu reads perform zero requests; refresh replaces the snapshot", async () => {
  let calls = 0
  const directory = new SpaceDirectory(fixtureSpaces, fixtureIdentity, async () => { calls++; return { current: "next", spaces: [{ projectKey: "next", displayName: "New" }] } })
  for (let i = 0; i < 20; i++) assert.equal(directory.list()[0]?.projectKey, "testSpace")
  assert.equal(calls, 0)
  await directory.refresh(new AbortController().signal)
  assert.equal(calls, 1); assert.equal(directory.list()[0]?.projectKey, "next")
  assert.throws(() => directory.assertAccount({ ...fixtureIdentity, userId: "other" }), /account changed/)
})
it("failed and cancelled refreshes do not replace usable cached choices", async () => {
  const directory = new SpaceDirectory(fixtureSpaces, fixtureIdentity, async () => { throw new Error("offline") })
  await assert.rejects(directory.refresh(new AbortController().signal), /offline/)
  assert.equal(directory.list()[0]?.projectKey, "testSpace")
  const abort = new AbortController()
  const cancelled = new SpaceDirectory(fixtureSpaces, fixtureIdentity, async () => { abort.abort(); return { current: null, spaces: [] } })
  await assert.rejects(cancelled.refresh(abort.signal), { name: "AbortError" })
  assert.equal(cancelled.list()[0]?.projectKey, "testSpace")
})

it("does not reuse a directory when account identity is unavailable", () => {
  const directory = new SpaceDirectory(fixtureSpaces, { ...fixtureIdentity, userId: null }, async () => fixtureSpaces)
  assert.equal(directory.matchesAccount({ ...fixtureIdentity, userId: null }), false)
  assert.equal(directory.matchesAccount(fixtureIdentity), false)
})
