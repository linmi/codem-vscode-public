import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { CODEM_UI_INTERACTION_OWNERS } from "../../../src/services/app-server/ui-parity.ts"

const vscodeRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const PRODUCT_CUT = [
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
  "requestMigrationData",
  "startMigration",
] as const

describe("product-cut Core v1 protocol gaps", () => {
  it("removes the 36 gap commands from WebviewMessage", () => {
    const source = readFileSync(join(vscodeRoot, "webview-ui/src/types/messages/webview-messages.ts"), "utf8")
    for (const command of PRODUCT_CUT) {
      assert.equal(new RegExp(`type:\\s*"${command}"`).test(source), false, command)
      assert.equal(Object.hasOwn(CODEM_UI_INTERACTION_OWNERS, command), false, command)
    }
  })
})
