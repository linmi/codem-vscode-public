import * as vscode from "vscode"
import { inhibitorCommand, KeepAwake, type KeepAwakePhase } from "./keepAwake.ts"

/**
 * The keep-awake toggle and its status bar item. The item is hidden until the inhibitor is starting or on, so the
 * first frame and every reload show nothing; clicking it turns keep-awake off.
 */
export function registerKeepAwake(log: (message: string) => void): vscode.Disposable {
  const item = vscode.window.createStatusBarItem("codem.keepAwake", vscode.StatusBarAlignment.Right, 100)
  item.name = "CodeM 防休眠"
  item.command = "codem.toggleKeepAwake"
  const show = (phase: KeepAwakePhase) => {
    void vscode.commands.executeCommand("setContext", "codem.keepAwake", phase !== "off")
    if (phase === "off") { item.hide(); return }
    item.text = phase === "starting" ? "$(loading~spin) 防休眠" : "$(coffee) 防休眠"
    item.tooltip = phase === "starting" ? "正在开启防休眠" : "CodeM 正在阻止系统空闲休眠，点击关闭"
    item.accessibilityInformation = { label: phase === "starting" ? "正在开启防休眠" : "防休眠已开启，点击关闭" }
    item.show()
  }
  const keepAwake = new KeepAwake({
    command: inhibitorCommand(process.platform, process.pid),
    publish: phase => { log(`Keep awake: ${phase}`); show(phase) },
    failed: message => { log(`Keep awake: ${message}`); void vscode.window.showErrorMessage(message) },
  })
  return vscode.Disposable.from(
    keepAwake,
    item,
    vscode.commands.registerCommand("codem.toggleKeepAwake", () => keepAwake.toggle()),
  )
}
