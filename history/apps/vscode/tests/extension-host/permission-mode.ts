import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import * as vscode from "vscode"
import { CodeMAppServerService } from "../../src/services/app-server/service"
import { CodeMAuthenticationService } from "../../src/services/app-server/authentication"
import { MatureUiAppServerController } from "../../src/services/app-server/mature-ui-controller"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages/extension-messages"

/** Run with VS Code --extensionTestsPath after bundling with vscode external. */
export async function run(): Promise<void> {
  assert.equal(vscode.workspace.isTrusted, true)
  const extension = vscode.extensions.getExtension("codem.codem")
  assert.ok(extension, "CodeM development extension must be loaded")
  await extension.activate()
  const commands = await vscode.commands.getCommands()
  assert.ok(commands.includes("codem.selectPermissionMode"))
  assert.equal(commands.includes("codem.toggleAutoApprove"), false)
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  assert.ok(workspace, "Run this test in a disposable, trusted workspace")
  // macOS tmpdir uses /var, whereas Core reports its canonical /private/var cwd.
  const cwd = realpathSync(workspace)
  const context = {
    extension,
    extensionPath: extension.extensionPath,
    globalStorageUri: vscode.Uri.joinPath(vscode.Uri.file(cwd), "authentication-test"),
  } as vscode.ExtensionContext
  const authentication = new CodeMAuthenticationService(context)
  const service = new CodeMAppServerService(context, authentication)
  const first: ExtensionMessage[] = []
  const second: ExtensionMessage[] = []
  const controller = (messages: ExtensionMessage[]) =>
    new MatureUiAppServerController({
      service,
      cwdForThread: () => cwd,
      preparePrompt: async () => {
        throw new Error("This test must not execute a turn")
      },
      post: (message) => {
        messages.push(message)
      },
      selectThread: () => {},
    })
  const a = controller(first)
  const b = controller(second)
  const subscription = service.onEvent((event) => {
    a.acceptEvent(event)
    b.acceptEvent(event)
  })
  let threadId: string | undefined
  try {
    await authentication.requireAuthenticated()
    threadId = await service.startThread(cwd, undefined, "high", "yolo")
    assert.equal((await service.readModes(cwd, threadId)).permissionMode, "yolo")
    await a.handle({ type: "requestThreadModes", sessionID: threadId, requestID: "a-read" })
    await b.handle({ type: "requestThreadModes", sessionID: threadId, requestID: "b-read" })
    await service.resumeThread(cwd, threadId, undefined, "medium")
    let state = await service.readModes(cwd, threadId)
    assert.equal(state.permissionMode, "yolo", "Changing thinking effort must preserve Core permission mode")
    for (const permissionMode of ["default", "auto", "yolo", "default"] as const) {
      await a.handle({
        type: "setThreadPermissionMode",
        sessionID: threadId,
        requestID: permissionMode,
        expectedRevision: state.revision,
        permissionMode,
      })
      const reply = first.at(-1)
      assert.ok(reply?.type === "threadModesResult" && "state" in reply.result, JSON.stringify(reply))
      state = reply.result.state
      assert.equal(state.permissionMode, permissionMode)
      assert.ok(
        second.some(
          (message) =>
            message.type === "threadModesChanged" &&
            message.state?.revision === state.revision &&
            message.state.permissionMode === permissionMode,
        ),
      )
    }
    await b.handle({
      type: "setThreadPermissionMode",
      sessionID: threadId,
      requestID: "stale",
      expectedRevision: 0,
      permissionMode: "yolo",
    })
    const rejected = second.at(-1)
    assert.ok(rejected?.type === "threadModesResult" && "error" in rejected.result)
    assert.match(rejected.result.error, /revision conflict/)
    await service.unsubscribeThread(cwd, threadId)
    assert.ok(first.some((message) => message.type === "threadModesChanged" && message.state === null))
    await service.resumeThread(cwd, threadId)
    assert.equal((await service.readModes(cwd, threadId)).permissionMode, "default")
    console.log(
      "PERMISSION_MODE_EXTENSION_HOST_PASS: presets, intelligence change, real Core, two surfaces, CAS conflict, unsubscribe/resume",
    )
  } finally {
    try {
      if (threadId) await service.deleteThread(cwd, threadId)
    } finally {
      subscription.dispose()
      service.dispose()
      authentication.dispose()
    }
  }
}
