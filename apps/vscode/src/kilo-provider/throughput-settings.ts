import * as vscode from "vscode"

type Post = (msg: unknown) => void

export function buildThroughputSettingMessage() {
  const config = vscode.workspace.getConfiguration("codem")
  return {
    type: "throughputSettingLoaded" as const,
    visible: config.get<boolean>("showTokenThroughput", true),
  }
}

export function watchThroughputConfig(post: Post): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("codem.showTokenThroughput")) {
      post(buildThroughputSettingMessage())
    }
  })
}
