import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import * as vscode from "vscode"
import { runNativeFeatureSmoke } from "./nativeFeatureSmoke.ts"
import { runLiveFeatures } from "./liveFeatures.ts"
import { runLiveChat } from "./liveChat.ts"

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("codem.codem")
  assert.ok(extension, "CodeM development extension is registered")
  await extension.activate()
  assert.equal(extension.isActive, true)
  const commands = await vscode.commands.getCommands(true)
  for (const command of ["codem.open", "codem.history", "codem.newChat", "codem.connect", "codem.signIn", "codem.showOutput"]) assert.ok(commands.includes(command), command)
  await vscode.commands.executeCommand("codem.open")
  await vscode.commands.executeCommand("codem.newChat")
  await runNativeFeatureSmoke()
  if (process.env.CODEM_LIVE_SMOKE === "1") {
    if (process.env.CODEM_FEATURE_LIVE === "1") await runLiveFeatures(extension.extensionPath)
    else await runLiveChat(extension.extensionPath)
  }
  assert.ok(process.env.CODEM_SMOKE_RESULT)
  writeFileSync(process.env.CODEM_SMOKE_RESULT, "ok")
  console.log("CODEM_EXTENSION_SMOKE_OK: activation, commands and webview")
}
