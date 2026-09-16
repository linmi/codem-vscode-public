import assert from "node:assert/strict"
import { realpathSync, writeFileSync } from "node:fs"
import * as vscode from "vscode"
import { CodeMAppServerService } from "../../src/services/app-server/service"
import { CodeMAuthenticationService } from "../../src/services/app-server/authentication"
import { MatureUiAppServerController } from "../../src/services/app-server/mature-ui-controller"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages/extension-messages"

/** Uses the already-selected space; never changes the account to another space or runs an agent turn. */
export async function run(): Promise<void> {
  try {
    await runSpaces()
  } catch (error: unknown) {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const detail = error instanceof Error ? `${error.message}\n${error.stack}` : String(error)
    if (workspace) writeFileSync(`${workspace}/spaces-failure.txt`, detail)
    console.error("SPACES_EXTENSION_HOST_FAILED", detail)
    throw error
  }
}

async function runSpaces(): Promise<void> {
  assert.equal(vscode.workspace.isTrusted, true)
  const extension = vscode.extensions.getExtension("codem.codem")
  assert.ok(extension)
  await extension.activate()
  assert.ok((await vscode.commands.getCommands()).includes("codem.selectSpace"))
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  assert.ok(workspace)
  const cwd = realpathSync(workspace)
  const context = {
    extension,
    extensionPath: extension.extensionPath,
    globalStorageUri: vscode.Uri.joinPath(vscode.Uri.file(cwd), "spaces-test-authentication"),
  } as vscode.ExtensionContext
  const authentication = new CodeMAuthenticationService(context)
  const service = new CodeMAppServerService(context, authentication)
  const messages: ExtensionMessage[] = []
  const controller = new MatureUiAppServerController({
    service,
    cwdForThread: () => cwd,
    preparePrompt: async () => {
      throw new Error("This test must not run an agent turn")
    },
    post: (message) => {
      messages.push(message)
    },
    selectThread: () => {},
  })
  const events: string[] = []
  const eventSubscription = service.onEvent((event) => {
    events.push(event.type)
    controller.acceptEvent(event)
  })
  let refresh: Promise<void> = Promise.resolve()
  const selectionSubscription = service.onDidChangeSpace((space) => {
    if (space) refresh = controller.refreshSpace()
  })
  let threadId: string | undefined
  try {
    const list = await service.listSpaces(cwd)
    assert.ok(list.current && list.spaces.some((space) => space.projectKey === list.current))
    assert.ok(list.spaces.every((space) => Object.keys(space).sort().join(",") === "displayName,projectKey"))
    const initial = service.listModels(cwd)
    await assert.rejects(service.selectSpace(cwd, list.current), /finish before switching/)
    await initial
    await refresh
    threadId = await service.startThread(cwd)
    await controller.handle({ type: "requestThreadModes", sessionID: threadId, requestID: "space-before" })
    await assert.rejects(service.selectSpace(cwd, "../invalid"), /Invalid CodeM space key/)
    assert.ok(await service.readModes(cwd, threadId), "rejected selection keeps existing thread usable")
    const switching = service.selectSpace(cwd, list.current)
    await assert.rejects(service.startThread(cwd), /switching spaces/)
    await switching
    await refresh
    assert.ok(events.includes("thread-closed"))
    assert.ok(messages.some((message) => message.type === "providersLoaded"))
    assert.ok(messages.some((message) => message.type === "skillsLoaded"))
    await assert.rejects(service.readModes(cwd, threadId), /not loaded/)
    await service.resumeThread(cwd, threadId)
    assert.ok(await service.readModes(cwd, threadId))
    assert.equal((await service.listSpaces(cwd)).current, list.current)
    console.log(
      "SPACES_EXTENSION_HOST_PASS: native command, broker catalog, Core launch, failure preservation, concurrent exclusion, retirement, model/skill refresh, resume",
    )
  } finally {
    try {
      if (threadId) await service.deleteThread(cwd, threadId)
    } finally {
      eventSubscription.dispose()
      selectionSubscription.dispose()
      service.dispose()
      authentication.dispose()
    }
  }
}
