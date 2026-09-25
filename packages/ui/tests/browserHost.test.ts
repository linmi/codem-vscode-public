import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createBrowserHost, type DraftStorage } from "../src/browserHost.ts"

function memoryStorage(initial: Record<string, string> = {}): DraftStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  }
}

function state(version: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "state", phase: "ready", version, ...extra })
}

describe("JetBrains page bridge", () => {
  it("drops a snapshot older than the last one applied", () => {
    const host = createBrowserHost(() => {}, memoryStorage())
    const seen: unknown[] = []
    host.subscribe((message) => seen.push(message.version))

    host.receive(state(7, { phase: "ready", messages: [{ id: "done", role: "assistant", text: "completed" }] }))
    // A snapshot captured before turn/completed arrives late: it must not replace the completed turn.
    host.receive(state(6, { phase: "running", messages: [] }))

    assert.deepEqual(seen, [7])
    const current = host.getState() as Record<string, unknown>
    assert.equal(current.version, 7)
    assert.equal(current.phase, "ready")
    assert.deepEqual(current.messages, [{ id: "done", role: "assistant", text: "completed" }])
  })

  it("applies newer and repeated versions in order", () => {
    const host = createBrowserHost(() => {}, memoryStorage())
    const seen: unknown[] = []
    host.subscribe((message) => seen.push(message.version))

    host.receive(state(1))
    host.receive(state(3))
    host.receive(state(3))
    host.receive(state(2))
    host.receive(state(4))

    assert.deepEqual(seen, [1, 3, 3, 4])
    assert.equal((host.getState() as Record<string, unknown>).version, 4)
  })

  it("keeps the unsent draft across snapshots and reloads", () => {
    const storage = memoryStorage({ "codem.draft": "keep me" })
    const host = createBrowserHost(() => {}, storage)
    host.receive(state(1, { draft: "host must not overwrite" }))
    assert.equal(host.getState()?.draft, "keep me")

    host.setState({ draft: "newer" })
    assert.equal(storage.values.get("codem.draft"), "newer")
    host.setState({ draft: "" })
    assert.equal(storage.values.has("codem.draft"), false)
  })

  it("posts actions tagged for the Host bridge", () => {
    const posted: unknown[] = []
    const host = createBrowserHost((message) => posted.push(message), memoryStorage())
    host.postAction({ type: "ready" })
    assert.deepEqual(posted, [{ source: "codem-ui", action: { type: "ready" } }])
  })
})
