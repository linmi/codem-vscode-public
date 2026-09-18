import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const provider = readFileSync(join(import.meta.dir, "../../src/CodeMProvider.ts"), "utf8")

describe("CodeMProvider leftover memory handlers", () => {
  it("does not route leftover memory SSE or toggle leftover Kilo memory", () => {
    expect(provider).not.toContain("KiloProviderMemory")
    expect(provider).not.toContain("event.type === \"memory.status\"")
    expect(provider).not.toContain("public async showMemory")
    expect(provider).not.toContain("public async toggleMemory")
    expect(provider).not.toContain("@kilocode/kilo-memory")
  })
})
