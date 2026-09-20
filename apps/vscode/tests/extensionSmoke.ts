import { waitForTabs } from "./nativeTestWait.ts"
import { assertTrusted, connectRuntime } from "../src/connection/runtimeSession.ts"
import { runLiveInteractions } from "./liveInteractions.ts"
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
  for (const command of ["codem.open", "codem.history", "codem.newChat", "codem.connect", "codem.signIn", "codem.showOutput", "codem.openInTab", "codem.openInSidebar", "codem.addToContext", "codem.explainCode", "codem.fixCode", "codem.improveCode", "codem.terminalAddToContext", "codem.terminalSelectionToContext", "codem.generateCompletion", "codem.generateCommitMessage"]) assert.ok(commands.includes(command), command)
  await vscode.commands.executeCommand("codem.open")
  await vscode.commands.executeCommand("codem.newChat")
  await vscode.commands.executeCommand("codem.openInTab")
  await vscode.commands.executeCommand("codem.openInTab")
  const chatTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith("codem.editor"))
  await waitForTabs(() => chatTabs().length === 1, "chat editor did not open")
  assert.equal(chatTabs().length, 1)
  await vscode.commands.executeCommand("codem.openInSidebar")
  await waitForTabs(() => chatTabs().length === 0, "chat editor did not close")
  assert.equal(chatTabs().length, 0)
  await runNativeFeatureSmoke()
  if (process.env.CODEM_LIVE_SMOKE === "1") {
    if (process.env.CODEM_INTERACTIONS_LIVE === "1") await runLiveInteractions({ connect: signal => connectRuntime(extension.extensionPath, "0.2.0", false, signal), assertTrusted })
    else if (process.env.CODEM_FEATURE_LIVE === "1") await runLiveFeatures(extension.extensionPath)
    else await runLiveChat(extension.extensionPath)
  }
  assert.ok(process.env.CODEM_SMOKE_RESULT)
  writeFileSync(process.env.CODEM_SMOKE_RESULT, "ok")
  console.log("CODEM_EXTENSION_SMOKE_OK: activation, commands and webview")
}
