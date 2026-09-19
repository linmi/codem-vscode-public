import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const provider = readFileSync(join(import.meta.dir, "../../src/CodeMProvider.ts"), "utf8")

describe("CodeMProvider leftover config/indexing handlers", () => {
  it("does not keep leftover Kilo config write or indexing consent methods", () => {
    expect(provider).not.toContain("private async handleUpdateConfig")
    expect(provider).not.toContain("private async fetchAndSendConfig")
    expect(provider).not.toContain("private async fetchAndSendIndexingStatus")
    expect(provider).not.toContain("private async setIndexingConsent")
    expect(provider).not.toContain("private async sendIndexingSettings")
    expect(provider).not.toContain("new ConfigBindings")
  })
})
