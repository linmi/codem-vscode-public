import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const vscodeRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")

const DEAD_METHODS = [
  "handleDeleteMessage",
  "handleRevertSession",
  "handleUnrevertSession",
  "handleResumeSession",
  "handleProviderAction",
  "handleFetchCustomProviderModels",
  "fetchAndSendAgents",
  "removeSkillViaCli",
  "handleRemoveAgent",
  "handleRemoveMcp",
  "fetchAndSendMcpStatus",
  "handleMemoryMessage",
  "fetchAndSendConfig",
  "fetchAndSendGlobalConfig",
  "fetchAndSendIndexingStatus",
  "fetchAndSendKiloEmbeddingModels",
  "fetchAndSendImageModels",
  "promoteBackgroundJob",
  "fetchAndSendConfigUpdated",
  "fetchAndSendSandboxDefault",
  "handleSetSandboxDefault",
  "fetchAndSendSandboxStatus",
  "handleToggleSandbox",
  "handleUpdateConfig",
  "sendIndexingSettings",
  "setIndexingConsent",
  "syncIndexingConsent",
  "refreshConfig",
] as const

describe("dead leftover Host handlers", () => {
  it("deletes product-cut leftover methods from CodeMProvider", () => {
    const source = readFileSync(join(vscodeRoot, "src/CodeMProvider.ts"), "utf8")
    for (const method of DEAD_METHODS) {
      assert.equal(source.includes(`private async ${method}`), false, method)
      assert.equal(source.includes(`private ${method}`), false, method)
    }
    assert.equal(source.includes("KiloProviderMemory"), false)
    assert.equal(source.includes("@kilocode/kilo-memory"), false)
    assert.equal(source.includes("@kilocode/kilo-gateway"), false)
    assert.equal(source.includes("new ConfigBindings"), false)
  })

  it("fail-closes leftover memory and indexing commands", () => {
    const extension = readFileSync(join(vscodeRoot, "src/extension.ts"), "utf8")
    assert.match(extension, /codem\.openIndexingSettings[\s\S]*尚未迁移到 CodeM App Server: indexing/)
    assert.match(extension, /codem\.showMemory[\s\S]*尚未迁移到 CodeM App Server: memory/)
    assert.match(extension, /codem\.toggleMemory[\s\S]*尚未迁移到 CodeM App Server: memory/)
    const manager = readFileSync(join(vscodeRoot, "src/agent-manager/AgentManagerProvider.ts"), "utf8")
    assert.match(manager, /const UNMIGRATED = "尚未迁移到 CodeM App Server"/)
    assert.match(manager, /public async showMemory[\s\S]*\$\{UNMIGRATED\}: memory/)
    assert.match(manager, /public async toggleMemory[\s\S]*\$\{UNMIGRATED\}: memory/)
  })

  it("retires kilo-provider, Roo import, and leftover Agent Manager orchestration", () => {
    const manager = readFileSync(join(vscodeRoot, "src/agent-manager/AgentManagerProvider.ts"), "utf8")
    assert.match(manager, /Worktree \/ Kilo-session \/ PTY \/ setup-script orchestration is retired/)
    assert.equal(manager.includes("connectionService.getClient()"), false)
    assert.equal(manager.includes("WorktreeImporter"), false)
    const provider = readFileSync(join(vscodeRoot, "src/CodeMProvider.ts"), "utf8")
    assert.equal(provider.includes("legacy-migration"), false)
    assert.equal(provider.includes("requestMigrationData"), false)
    assert.equal(provider.includes("./kilo-provider/"), false)
  })
})
