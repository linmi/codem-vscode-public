import type { AppServerHostEvent, AppServerInteraction } from "@codem/app-server"
import assert from "node:assert/strict"
import { realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as vscode from "vscode"
import { CodeMAppServerService } from "../../src/services/app-server/service"
import { CodeMAuthenticationService } from "../../src/services/app-server/authentication"
import { AppServerMatureUiAdapter } from "../../src/services/app-server/mature-ui-adapter"
import { MatureUiAppServerController } from "../../src/services/app-server/mature-ui-controller"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages/extension-messages"

/**
 * 受信工作区 live 验收：登录 → sendMessage 单轮 → 一次 HITL → 销毁 Host 后 loadMessages
 * 必须与 Core JSONL schema 13 投影一致。不启动 kilo serve，Webview 只收 CodeM DTO。
 */
export async function run(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  assert.ok(workspace, "Run this test in a disposable, trusted workspace")
  const resultPath = process.env.CODEM_EXTENSION_HOST_RESULT ?? join(workspace, "EXTENSION_HOST_RESULT.txt")
  try {
    await runHitlReload(workspace)
    writeFileSync(resultPath, "HITL_RELOAD_EXTENSION_HOST_PASS\n")
    console.log("HITL_RELOAD_EXTENSION_HOST_PASS")
  } catch (error: unknown) {
    const detail = error instanceof Error ? `${error.message}\n${error.stack}` : String(error)
    writeFileSync(resultPath, `HITL_RELOAD_EXTENSION_HOST_FAILED\n${detail}\n`)
    console.error("HITL_RELOAD_EXTENSION_HOST_FAILED", detail)
    throw error
  }
}

async function runHitlReload(workspace: string): Promise<void> {
  assert.equal(vscode.workspace.isTrusted, true, "Workspace Trust is required before starting Core")
  const extension = vscode.extensions.getExtension("codem.codem")
  assert.ok(extension, "CodeM development extension must be loaded")
  await extension.activate()
  const cwd = realpathSync(workspace)
  const context = {
    extension,
    extensionPath: extension.extensionPath,
    globalStorageUri: vscode.Uri.joinPath(vscode.Uri.file(cwd), "hitl-reload-auth"),
  } as vscode.ExtensionContext
  const authentication = new CodeMAuthenticationService(context)
  const service = new CodeMAppServerService(context, authentication)
  const messages: ExtensionMessage[] = []
  const events: AppServerHostEvent[] = []
  const controller = new MatureUiAppServerController({
    service,
    cwdForThread: () => cwd,
    preparePrompt: async (message) => ({ text: message.text, attachments: [] }),
    post: (message) => {
      messages.push(message)
      console.log("LIVE_UI", message.type)
    },
    selectThread: () => {},
  })
  let threadId: string | undefined
  const subscription = service.onEvent((event) => {
    events.push(event)
    console.log("LIVE_CORE", event.type)
    controller.acceptEvent(event)
    if (event.type === "thread-started") threadId = event.threadId
  })
  try {
    await authentication.requireAuthenticated()
    await controller.handle({
      type: "sendMessage",
      draftID: "hitl-draft",
      messageID: "hitl-submission",
      text: "You must run the shell command `printf 'HITL_OK\\n' > hitl-ok.txt` using a bash/shell tool. Do not skip the tool call. After the command succeeds, reply with exactly DONE.",
      providerID: "codem-router",
      modelID: "auto",
      variant: "medium",
      permissionMode: "default",
    })
    const created = messages.find((message) => message.type === "sessionCreated")
    if (created?.type === "sessionCreated") threadId = created.session.id
    assert.ok(threadId, "Core must assign threadId")
    assert.equal(
      messages.some((message) => message.type === "sendMessageFailed"),
      false,
    )

    await answerHitlUntilTurnCompletes(controller, events, threadId)
    assert.equal(
      events.some((event) => event.type === "protocol-error" || event.type === "connection-closed"),
      false,
    )
    assert.equal(
      messages.some(
        (message) =>
          message.type === "providersLoaded" ||
          message.type === "commandsLoaded" ||
          message.type === "agentsLoaded",
      ),
      false,
      "Webview must only receive CodeM DTOs",
    )

    const settled = await waitForHistory(service, cwd, threadId)
    subscription.dispose()
    service.dispose()

    // 模拟 Extension Host 重启：新 service/controller 只能从 JSONL 重建时间线。
    const reloaded = new CodeMAppServerService(context, authentication)
    const reloadedMessages: ExtensionMessage[] = []
    const reloadedController = new MatureUiAppServerController({
      service: reloaded,
      cwdForThread: () => cwd,
      preparePrompt: async (message) => ({ text: message.text, attachments: [] }),
      post: (message) => reloadedMessages.push(message),
      selectThread: () => {},
    })
    try {
      const history = await reloaded.readHistory(cwd, threadId)
      assert.deepEqual(
        history.turns.map((entry) => entry.submissionId),
        settled.turns.map((entry) => entry.submissionId),
      )
      await reloadedController.handle({ type: "loadMessages", sessionID: threadId, mode: "replace" })
      const loaded = reloadedMessages.findLast((message) => message.type === "messagesLoaded")
      assert.ok(loaded?.type === "messagesLoaded")
      assert.equal(loaded.sessionID, threadId)
      assert.deepEqual(
        loaded,
        new AppServerMatureUiAdapter().messagesLoaded({
          threadId,
          turns: history.turns,
          mode: loaded.mode === "prepend" ? "prepend" : "replace",
          ...(history.nextCursor ? { cursor: history.nextCursor } : {}),
          hasMore: history.nextCursor !== null,
        }),
      )
      assert.ok(loaded.messages.some((message) => message.role === "user"))
      assert.ok(loaded.messages.some((message) => message.role === "assistant"))
    } finally {
      try {
        await reloaded.deleteThread(cwd, threadId)
      } finally {
        reloaded.dispose()
      }
    }
  } finally {
    subscription.dispose()
    service.dispose()
    authentication.dispose()
  }
}

async function answerHitlUntilTurnCompletes(
  controller: MatureUiAppServerController,
  events: readonly AppServerHostEvent[],
  threadId: string,
): Promise<void> {
  const answered = new Set<string>()
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const terminal = events.find(
      (event): event is Extract<AppServerHostEvent, { type: "turn-completed" }> =>
        event.type === "turn-completed" && event.threadId === threadId,
    )
    if (terminal) {
      if (terminal.outcome !== "completed") {
        throw new Error(`Turn ${terminal.outcome}: ${terminal.error ?? terminal.stopReason}`)
      }
      if (answered.size === 0) {
        throw new Error(
          `Turn finished without HITL (${terminal.stopReason}). events=${events.map((event) => event.type).join(",")}`,
        )
      }
      return
    }
    const pending = events.find(
      (event): event is Extract<AppServerHostEvent, { type: "interaction" }> =>
        event.type === "interaction" &&
        event.interaction.threadId === threadId &&
        !answered.has(event.interaction.requestId),
    )
    if (pending) {
      answered.add(pending.interaction.requestId)
      await answerHitl(controller, pending.interaction)
      continue
    }
    await delay(50)
  }
  throw new Error(`No completed turn after HITL in 120 seconds. events=${events.map((event) => event.type).join(",")}`)
}

async function answerHitl(
  controller: MatureUiAppServerController,
  interaction: AppServerInteraction,
): Promise<void> {
  if (interaction.kind === "permission") {
    await controller.handle({
      type: "permissionResponse",
      permissionId: interaction.requestId,
      sessionID: interaction.threadId,
      response: "once",
      approvedAlways: [],
      deniedAlways: [],
    })
    return
  }
  if (interaction.kind === "question") {
    await controller.handle({
      type: "questionReply",
      requestID: interaction.requestId,
      sessionID: interaction.threadId,
      answers: interaction.questions.map((question) => [question.options[0]?.label ?? "yes"]),
    })
    return
  }
  throw new Error(`Unsupported HITL kind ${interaction.kind}`)
}

async function waitForHistory(service: CodeMAppServerService, cwd: string, threadId: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const page = await service.readHistory(cwd, threadId)
    if (page.turns.some((entry) => entry.turn.state === "completed")) return page
    await delay(500)
  }
  throw new Error("JSONL schema 13 did not settle after turn/completed")
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
