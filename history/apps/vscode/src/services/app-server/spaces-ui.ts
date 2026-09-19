import * as vscode from "vscode"
import type { CodeMAppServerService } from "./service"

/**
 * 状态栏空间选择器。写入权威是 CLI broker（project_list / space_prepare / space_commit）。
 * Core `space/list` 只是只读快照，禁止用它替换本写路径。
 */
export function registerSpaceSelector(service: CodeMAppServerService): vscode.Disposable {
  const status = vscode.window.createStatusBarItem("codem.space", vscode.StatusBarAlignment.Left, 10)
  status.name = "CodeM Space"
  status.command = "codem.selectSpace"
  status.text = "$(organization) CodeM: Select Space"
  status.tooltip = "Choose the CodeM space used for new and reopened tasks"
  status.show()
  const changed = service.onDidChangeSpace((space) => {
    // Escape codicon syntax in server-provided names.
    const name = space?.displayName.replace(/\$\(/g, "＄(")
    status.text = `$(organization) CodeM: ${name ?? "Select Space"}`
  })
  let opening = false
  const command = vscode.commands.registerCommand("codem.selectSpace", async () => {
    if (opening) return
    opening = true
    try {
      if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before selecting a CodeM space.")
      const folders = vscode.workspace.workspaceFolders ?? []
      if (!folders.length) throw new Error("Open a workspace folder before selecting a CodeM space.")
      const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick()
      if (!folder) return
      const cwd = folder.uri.fsPath
      const list = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "CodeM: Loading spaces" },
        () => service.listSpaces(cwd),
      )
      if (!list.spaces.length) {
        await vscode.window.showInformationMessage("No CodeM spaces are available for this account.")
        return
      }
      const selection = await vscode.window.showQuickPick(
        list.spaces.map((space) => ({
          label: space.displayName.replace(/\$\(/g, "＄("),
          description: space.projectKey === list.current ? "Current space" : undefined,
          space,
        })),
        { title: "CodeM: Select Space", placeHolder: "Applies to new and reopened tasks; switch when tasks are idle" },
      )
      if (!selection) return
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `CodeM: Switching to ${selection.space.displayName}` },
        () => service.selectSpace(cwd, selection.space.projectKey),
      )
    } catch (error: unknown) {
      await vscode.window.showErrorMessage(error instanceof Error ? error.message : "Could not switch CodeM space")
    } finally {
      opening = false
    }
  })
  return vscode.Disposable.from(status, changed, command)
}
