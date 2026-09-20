import * as vscode from "vscode"
export async function waitForTabs(predicate: () => boolean, label: string): Promise<void> {
  if (predicate()) return
  await new Promise<void>((resolve, reject) => {
    const check = () => { if (predicate()) { clearTimeout(timer); listener.dispose(); groups.dispose(); resolve() } }
    const listener = vscode.window.tabGroups.onDidChangeTabs(check)
    const groups = vscode.window.tabGroups.onDidChangeTabGroups(check)
    const timer = setTimeout(() => {
      listener.dispose(); groups.dispose()
      reject(new Error(`${label}: ${JSON.stringify(vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => ({ label: tab.label, input: tab.input })))}`))
    }, 5000)
    check()
  })
}
