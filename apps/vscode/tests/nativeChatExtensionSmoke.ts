import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import * as vscode from "vscode"

/** Real Extension Host registration check; deliberately does not connect or call a model. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("codem.codem-native-experiment")
  assert.ok(extension, "The independent experimental manifest must load")
  await extension.activate()
  assert.equal(extension.isActive, true)
  const commands = await vscode.commands.getCommands(true)
  for (const id of ["codemNative.connect", "codemNative.signIn", "codemNative.showOutput"]) assert.ok(commands.includes(id), id)
  const result = process.env.CODEM_NATIVE_SMOKE_RESULT
  assert.ok(result)
  const models = await vscode.lm.selectChatModels({})
  await writeFile(result, `CODEM_NATIVE_EXTENSION_ACTIVATED\nNATIVE_CHAT_MODELS=${models.length}\n`)
}
