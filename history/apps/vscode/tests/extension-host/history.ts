import assert from "node:assert/strict"
import * as vscode from "vscode"
import { CodeMAppServerService } from "../../src/services/app-server/service"
import { CodeMAuthenticationService } from "../../src/services/app-server/authentication"
import { AppServerMatureUiAdapter } from "../../src/services/app-server/mature-ui-adapter"

/** Read-only acceptance of a user-selected real Core conversation; never creates, sends or deletes a turn. */
export async function run(): Promise<void> {
  const cwd = process.env.CODEM_HISTORY_TEST_CWD
  const threadId = process.env.CODEM_HISTORY_TEST_THREAD
  assert.ok(cwd && threadId, "Supply CODEM_HISTORY_TEST_CWD and CODEM_HISTORY_TEST_THREAD")
  const extension = vscode.extensions.getExtension("codem.codem")!
  const context = {
    extension,
    extensionPath: extension.extensionPath,
    globalStorageUri: vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, "test-auth"),
  } as vscode.ExtensionContext
  const authentication = new CodeMAuthenticationService(context)
  try {
    let previous: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const service = new CodeMAppServerService(context, authentication)
      try {
        const history = await service.readHistory(cwd, threadId)
        assert.equal(history.turns.length, 3)
        assert.equal(new Set(history.turns.map((t) => t.submissionId)).size, 3)
        const loaded = new AppServerMatureUiAdapter().messagesLoaded({ threadId, turns: history.turns })
        assert.ok(loaded.type === "messagesLoaded")
        assert.deepEqual(
          loaded.messages.map((m) => m.role),
          ["user", "assistant", "user", "assistant", "user", "assistant"],
        )
        for (const user of loaded.messages.filter((m) => m.role === "user")) {
          assert.ok(user.parts?.[0]?.type === "text")
          assert.equal(user.parts[0].text, user.content)
        }
        const first = loaded.messages[1]!.parts!.find((p) => p.type === "text")
        assert.ok(first?.type === "text")
        assert.equal(first.text, "FIRST LINE\n\nLAST LINE")
        for (const assistant of loaded.messages.filter((m) => m.role === "assistant")) {
          const tool = assistant.parts?.find((p) => p.type === "tool" && p.tool === "final_answer")
          assert.ok(tool?.type === "tool" && tool.state.status === "completed")
          assert.equal(typeof tool.state.input.summary, "string")
          assert.ok(tool.state.output.length > 0)
        }
        if (previous) assert.deepEqual(loaded, previous)
        previous = loaded
      } finally {
        service.dispose()
      }
    }
  } finally {
    authentication.dispose()
  }
  console.log("HISTORY_EXTENSION_HOST_PASS")
}
