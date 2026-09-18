import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  CODEM_UI_INTERACTION_OWNERS,
  isAppServerOwned,
  unmigratedAppServerCommandMessage,
} from "../../../../src/services/app-server/ui-parity.ts"
import {
  APP_SERVER_V1_PROTOCOL_GAPS,
  assertMatureUiProductionReady,
  matureUiParityReport,
} from "../../../../src/services/app-server/ui-parity-gate.ts"

const PRODUCT_CUT_COMMANDS = [
  "authenticateMcp",
  "authorizeProviderOAuth",
  "completeProviderOAuth",
  "connectMcp",
  "connectProvider",
  "deleteMessage",
  "disconnectMcp",
  "disconnectProvider",
  "fetchCustomProviderModels",
  "memoryOperation",
  "memoryShow",
  "promoteBackgroundJob",
  "removeAgent",
  "removeMcp",
  "removeSkill",
  "requestAgents",
  "requestConfig",
  "requestGlobalConfig",
  "requestImageModels",
  "requestIndexingSettings",
  "requestIndexingStatus",
  "requestKiloEmbeddingModels",
  "requestMcpStatus",
  "requestMemory",
  "requestSandboxDefault",
  "requestSandboxStatus",
  "resumeSession",
  "revertSession",
  "saveCustomProvider",
  "setIndexingConsent",
  "setSandboxDefault",
  "suggestionAccept",
  "suggestionDismiss",
  "toggleSandbox",
  "unrevertSession",
  "updateConfig",
] as const

describe("mature UI production parity gate", () => {
  it("does not authorize retired voice-input commands", () => {
    for (const command of [
      "requestSpeechToTextModels",
      "speechToTextPrewarm",
      "speechToTextStart",
      "speechToTextStop",
      "speechToTextCancel",
    ]) {
      assert.equal(Object.hasOwn(CODEM_UI_INTERACTION_OWNERS, command), false, command)
    }
  })

  it("product-cuts Core v1 protocol-gap commands from the ownership table", () => {
    for (const command of PRODUCT_CUT_COMMANDS) {
      assert.equal(Object.hasOwn(CODEM_UI_INTERACTION_OWNERS, command), false, command)
    }
  })

  it("accounts for the complete 241-command mature Webview surface", () => {
    const report = matureUiParityReport()
    assert.equal(report.totalCommands, 241)
    assert.equal(report.preservedHostCommands, 199)
    assert.equal(report.appServerCommands, 42)
    assert.equal(report.controllerReady.length, 42)
    assert.equal(report.controllerPending.length, 0)
    assert.equal(report.protocolGaps.length, 0)
    assert.equal(
      report.preservedHostCommands +
        report.controllerReady.length +
        report.controllerPending.length +
        report.protocolGaps.length,
      report.totalCommands,
    )
    assert.equal(report.ready, true)
  })

  it("keeps every App Server-owned command controller-mapped", () => {
    assert.equal(Object.keys(APP_SERVER_V1_PROTOCOL_GAPS).length, 0)
    assert.equal(matureUiParityReport().controllerReady.includes("requestProviders"), true)
    assert.equal(matureUiParityReport().controllerReady.includes("requestSessionModelUsage"), true)
    assert.equal(matureUiParityReport().controllerReady.includes("requestCoreSpaceSnapshot"), true)
    assert.doesNotThrow(() => assertMatureUiProductionReady())
  })

  it("fail-closes App Server control leaks instead of routing them to Kilo", () => {
    assert.equal(isAppServerOwned("app-server-live"), true)
    assert.equal(isAppServerOwned("app-server-control"), true)
    assert.equal(isAppServerOwned("editor-host"), false)
    assert.equal(CODEM_UI_INTERACTION_OWNERS.requestConfigSnapshot, "app-server-control")
    assert.equal(
      unmigratedAppServerCommandMessage("requestConfigSnapshot"),
      "尚未迁移到 CodeM App Server: requestConfigSnapshot",
    )
  })
})
