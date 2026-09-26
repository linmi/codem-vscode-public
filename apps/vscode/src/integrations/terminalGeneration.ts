import * as vscode from "vscode"
import { basename } from "node:path"
import { assertCommandRequest, terminalCommand, terminalCommandPrompt } from "./terminalCommand.ts"
import { assertTrusted } from "../connection/runtimeSession.ts"
import type { ChatController } from "../chat/chatController.ts"

/** The chat calls command generation makes: the context it must not outlive and one generation. */
type CommandChat = Pick<ChatController, "contextKey" | "generateText">

/**
 * Describe → generate one line → preview → insert into the terminal that was active when the command started.
 * Inserting never presses Enter; the person runs, edits or discards the line. One generation at a time.
 */
export function registerTerminalGeneration(chat: CommandChat, log: (message: string) => void): vscode.Disposable {
  let active: AbortController | null = null
  const command = vscode.commands.registerCommand("codem.generateTerminalCommand", async () => {
    if (active) { void vscode.window.showInformationMessage("正在生成终端命令，可在进度通知中取消。"); return }
    const abort = new AbortController()
    try {
      assertTrusted()
      const terminal = vscode.window.activeTerminal
      const request = await vscode.window.showInputBox({
        title: "生成终端命令",
        prompt: "描述要在终端中完成的操作。生成后先预览，插入终端也不会自动执行。",
        placeHolder: "例如：列出最近 7 天修改过的 TypeScript 文件",
        ignoreFocusOut: true,
        validateInput: value => value.length > 2000 ? "描述超过 2000 字符，请精简。" : null,
      })
      if (request === undefined || !request.trim()) return
      assertCommandRequest(request)
      if (active) return
      active = abort
      const started = performance.now()
      const scope = chat.contextKey()
      const shell = terminal?.state.shell ?? vscode.env.shell
      const cwd = terminal?.shellIntegration?.cwd
      const context = { platform: process.platform, shell: shell ? basename(shell) : "unknown", cwd: cwd?.scheme === "file" ? vscode.workspace.asRelativePath(cwd, true) : null }
      const line = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "CodeM 正在生成终端命令", cancellable: true }, async (_progress, token) => {
        const subscription = token.onCancellationRequested(() => abort.abort())
        try {
          assertTrusted(); abort.signal.throwIfAborted()
          const response = await chat.generateText(terminalCommandPrompt(request, context), abort.signal, scope)
          abort.signal.throwIfAborted()
          return terminalCommand(response)
        } finally { subscription.dispose(); log(`Terminal command generation: ${Math.round(performance.now() - started)}ms`) }
      })
      active = null
      const choice = await vscode.window.showInformationMessage("将生成的命令插入终端？", { modal: true, detail: `${line}\n\n插入后不会自动执行，请确认后自行按回车。` }, "插入终端", "复制")
      if (choice === "复制") { await vscode.env.clipboard.writeText(line); return }
      if (choice !== "插入终端") return
      assertTrusted()
      if (terminal && terminal.exitStatus !== undefined) throw new Error("原终端已关闭，命令未插入，请重新生成。")
      const target = terminal ?? vscode.window.createTerminal({ name: "CodeM" })
      target.show()
      // addNewLine=false: the line lands at the prompt and waits for the person.
      target.sendText(line, false)
    } catch (error) {
      if (!abort.signal.aborted) void vscode.window.showErrorMessage(error instanceof Error ? error.message : "终端命令生成失败，请重试。")
    } finally { if (active === abort) active = null }
  })
  return vscode.Disposable.from(command, { dispose() { active?.abort() } })
}
