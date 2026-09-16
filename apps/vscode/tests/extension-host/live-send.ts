import type { AppServerHostEvent } from "@codem/app-server"
import assert from "node:assert/strict"
import { realpathSync } from "node:fs"
import * as vscode from "vscode"
import { CodeMAppServerService } from "../../src/services/app-server/service"
import { CodeMAuthenticationService } from "../../src/services/app-server/authentication"
import { MatureUiAppServerController } from "../../src/services/app-server/mature-ui-controller"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages/extension-messages"

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("codem.codem")!
  const cwd = realpathSync(vscode.workspace.workspaceFolders![0].uri.fsPath)
  const context = {
    extension,
    extensionPath: extension.extensionPath,
    globalStorageUri: vscode.Uri.joinPath(vscode.Uri.file(cwd), "auth-test"),
  } as vscode.ExtensionContext
  const authentication = new CodeMAuthenticationService(context)
  const service = new CodeMAppServerService(context, authentication)
  const messages: ExtensionMessage[] = []
  const events: AppServerHostEvent[] = []
  const pending: Promise<unknown>[] = []
  let threadId: string | undefined
  let finish!: () => void
  let fail!: (error: Error) => void
  const completed = new Promise<void>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  void completed.catch(() => {})
  const controller = new MatureUiAppServerController({
    service,
    cwdForThread: () => cwd,
    preparePrompt: async (message) => ({ text: message.text, attachments: [] }),
    selectThread: () => {},
    post: (message) => {
      messages.push(message)
      console.log("LIVE_UI", message.type, "error" in message ? message.error : "")
      if (message.type === "sessionCreated") {
        threadId = message.session.id
        pending.push(controller.handle({ type: "requestThreadModes", sessionID: threadId, requestID: "initial-mode" }))
        pending.push(controller.handle({ type: "loadMessages", sessionID: threadId }))
      }
    },
  })
  const subscription = service.onEvent((event) => {
    events.push(event)
    console.log("LIVE_CORE", event.type)
    controller.acceptEvent(event)
    if (event.type === "turn-completed") {
      if (event.outcome === "completed") finish()
      else fail(new Error(`Turn ${event.outcome}: ${event.error ?? event.stopReason}`))
    }
    if (event.type === "protocol-error") fail(new Error(event.message))
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await authentication.requireAuthenticated()
    await controller.handle({
      type: "sendMessage",
      draftID: "live-draft",
      messageID: "live-submission",
      text: "Reply with exactly OK. Do not use tools or inspect any files.",
      providerID: "codem-router",
      modelID: "auto",
      variant: "medium",
      permissionMode: "auto",
    })
    await Promise.all(pending)
    assert.equal(
      messages.some((m) => m.type === "sendMessageFailed"),
      false,
    )
    await Promise.race([
      completed,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("No terminal event in 90 seconds")), 90000)
      }),
    ])
    assert.ok(threadId)
    assert.equal(
      events.some((event) => event.type === "protocol-error" || event.type === "connection-closed"),
      false,
    )
    assert.ok(
      messages.some(
        (message) => message.type === "partUpdated" && message.part.type === "text" && message.part.text.includes("OK"),
      ),
      "expected the actual assistant answer",
    )
    const modes = await service.readModes(cwd, threadId)
    assert.equal(modes.permissionMode, "auto")
    assert.equal(
      messages.some((message) => message.type === "error"),
      false,
    )
  } finally {
    if (timeout) clearTimeout(timeout)
    try {
      if (threadId) await service.deleteThread(cwd, threadId)
    } finally {
      subscription.dispose()
      service.dispose()
      authentication.dispose()
    }
  }
  console.log("LIVE_SEND_EXTENSION_HOST_PASS")
}
