import * as vscode from "vscode"
import { randomUUID } from "node:crypto"
import { TerminalOutput, terminalPrompt } from "./terminalContext.ts"
import { assertTrusted } from "../connection/runtimeSession.ts"

export function registerTerminalActions(addContext: (text: string) => Promise<void>): vscode.Disposable {
  const outputs = new Map<vscode.Terminal, { execution: vscode.TerminalShellExecution; output: TerminalOutput; command: string; failed: boolean; stop: () => void }>()
  let disposed = false
  let readingSelection = false
  const report = (error: unknown) => { void vscode.window.showErrorMessage(error instanceof Error ? error.message : "无法读取终端内容。") }
  const collect = (event: vscode.TerminalShellExecutionStartEvent) => {
    if (!vscode.workspace.isTrusted) return
    const stream = event.execution.read()[Symbol.asyncIterator]()
    outputs.get(event.terminal)?.stop()
    const stop = () => { void Promise.resolve(stream.return?.()).catch(() => undefined) }
    const entry = { execution: event.execution, output: new TerminalOutput(), command: event.execution.commandLine.value.slice(0, 2000), failed: false, stop }
    outputs.set(event.terminal, entry)
    void (async () => {
      try { for await (const chunk of { [Symbol.asyncIterator]: () => stream }) { if (disposed || outputs.get(event.terminal) !== entry) break; entry.output.append(chunk) } }
      catch { entry.failed = true }
    })()
  }
  const recent = async (action: "context" | "explain" | "fix") => {
    assertTrusted()
    const terminal = vscode.window.activeTerminal
    const entry = terminal && outputs.get(terminal)
    if (!entry) throw new Error("未捕获到最近命令。请启用终端 Shell Integration 后重新运行命令，或使用「复制终端选区并加入上下文」。")
    if (entry.failed) throw new Error("终端输出读取中断，请重新运行命令后重试。")
    await addContext(terminalPrompt(action, `${entry.command}\n${entry.output.snapshot()}`))
  }
  const selection = async () => {
    assertTrusted()
    if (readingSelection) return
    const terminal = vscode.window.activeTerminal
    if (!terminal) throw new Error("请先在终端中选择文本。")
    readingSelection = true
    const previous = await vscode.env.clipboard.readText()
    const marker = `codem-selection-${randomUUID()}`
    let captured = ""
    try {
      // A marker prevents an empty selection from accidentally importing the old clipboard.
      // Successful invocation is explicitly a copy operation; the selection remains on the clipboard.
      await vscode.env.clipboard.writeText(marker)
      terminal.show(true)
      await vscode.commands.executeCommand("workbench.action.terminal.copySelection")
      for (let attempt = 0; attempt < 40; attempt++) {
        const value = await vscode.env.clipboard.readText()
        if (value !== marker) { captured = value; break }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      if (vscode.window.activeTerminal !== terminal) throw new Error("活动终端已改变，请重新选择文本。")
      assertTrusted()
      await addContext(terminalPrompt("context", captured))
    } finally {
      if (await vscode.env.clipboard.readText() === marker) await vscode.env.clipboard.writeText(previous)
      readingSelection = false
    }
  }
  return vscode.Disposable.from(
    { dispose() { disposed = true; for (const entry of outputs.values()) entry.stop(); outputs.clear() } },
    vscode.window.onDidStartTerminalShellExecution(collect),
    vscode.window.onDidCloseTerminal(terminal => { outputs.get(terminal)?.stop(); outputs.delete(terminal) }),
    vscode.commands.registerCommand("codem.terminalSelectionToContext", () => selection().catch(report)),
    ...([ ["terminalAddToContext", "context"], ["terminalExplainCommand", "explain"], ["terminalFixCommand", "fix"] ] as const).map(([command, action]) => vscode.commands.registerCommand(`codem.${command}`, () => recent(action).catch(report))),
  )
}
