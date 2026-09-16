import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { CODEM_UI_INTERACTION_OWNERS } from "../../../../src/services/app-server/ui-parity.ts"
import {
  APP_SERVER_V1_PROTOCOL_GAPS,
  assertMatureUiProductionReady,
  matureUiParityReport,
} from "../../../../src/services/app-server/ui-parity-gate.ts"

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
  it("accounts for the complete 257-command mature Webview surface", () => {
    const report = matureUiParityReport()
    assert.equal(report.totalCommands, 257)
    assert.equal(report.preservedHostCommands, 199)
    assert.equal(report.appServerCommands, 58)
    assert.equal(report.controllerReady.length, 20)
    assert.equal(report.controllerPending.length, 0)
    assert.equal(report.protocolGaps.length, 38)
    assert.equal(
      report.preservedHostCommands +
        report.controllerReady.length +
        report.controllerPending.length +
        report.protocolGaps.length,
      report.totalCommands,
    )
  })

  it("keeps every missing Core v1 semantic explicit and blocks production cutover", () => {
    assert.equal(Object.keys(APP_SERVER_V1_PROTOCOL_GAPS).length, 38)
    assert.equal(APP_SERVER_V1_PROTOCOL_GAPS.promoteBackgroundJob.includes("cannot promote"), true)
    assert.equal(matureUiParityReport().controllerReady.includes("requestProviders"), true)
    assert.equal(APP_SERVER_V1_PROTOCOL_GAPS.updateConfig.includes("no project/global"), true)
    assert.throws(
      () => assertMatureUiProductionReady(),
      /protocolGaps=.*deleteMessage.*promoteBackgroundJob.*unrevertSession.*updateConfig/u,
    )
  })
})
