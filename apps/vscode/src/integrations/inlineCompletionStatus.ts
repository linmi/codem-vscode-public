import * as vscode from "vscode"

type CompletionActivity = "idle" | "waiting" | "generating" | "cancelling" | "failed"
type SettingItem = vscode.QuickPickItem & { key: "completion.enabled" | "completion.autoTrigger" }

/** Native status/menu only; generation and cancellation remain owned by the provider. */
export class InlineCompletionStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem("codem.completion", vscode.StatusBarAlignment.Right, 10)
  private readonly subscriptions: vscode.Disposable[]
  private picker: vscode.QuickPick<SettingItem> | null = null
  private readonly generateButton = { iconPath: new vscode.ThemeIcon("play"), tooltip: "手动生成补全" }
  private readonly cancelButton = { iconPath: new vscode.ThemeIcon("debug-stop"), tooltip: "取消当前补全" }
  private readonly settingsButton = { iconPath: new vscode.ThemeIcon("gear"), tooltip: "打开补全设置" }
  private activity: CompletionActivity = "idle"
  private disposed = false

  constructor() {
    this.item.name = "CodeM 行内补全"
    this.item.command = "codem.completionMenu"
    this.subscriptions = [
      vscode.commands.registerCommand("codem.completionMenu", () => this.openMenu()),
      vscode.window.onDidChangeActiveTextEditor(() => { this.picker?.hide(); if (this.activity === "failed") this.activity = "idle"; this.render() }),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration("codem.completion") || event.affectsConfiguration("editor.inlineSuggest.enabled")) this.render() }),
    ]
    this.render()
  }

  setActivity(activity: CompletionActivity): void { this.activity = activity; this.render() }

  private render(): void {
    if (this.disposed) return
    const uri = vscode.window.activeTextEditor?.document.uri
    const config = vscode.workspace.getConfiguration("codem", uri)
    const enabled = config.get<boolean>("completion.enabled", true)
    const automatic = config.get<boolean>("completion.autoTrigger", true)
    const inline = vscode.workspace.getConfiguration("editor", uri).get<boolean>("inlineSuggest.enabled", true)
    const label = this.activity === "generating" ? "$(loading~spin) CodeM 生成中"
      : this.activity === "cancelling" ? "$(loading~spin) CodeM 取消中"
      : this.activity === "waiting" ? "$(clock) CodeM 等待补全"
      : !enabled ? "$(circle-slash) CodeM 补全已关闭"
      : this.activity === "failed" ? "$(warning) CodeM 补全失败"
      : automatic && inline ? "$(sparkle) CodeM 自动补全" : "$(edit) CodeM 手动补全"
    this.item.text = label
    this.item.tooltip = `${label.replace(/\$\([^)]+\) /g, "")}\n${!inline && automatic ? "VS Code 自动内联建议已关闭。\n" : ""}点击管理补全开关、手动生成或取消。补全需要已连接且空闲的 CodeM。`
    this.item.accessibilityInformation = { label: this.item.tooltip, role: "button" }
    this.item.show()
    if (this.picker) this.picker.buttons = this.buttons()
  }

  private buttons(): vscode.QuickInputButton[] {
    return [
      this.generateButton,
      ...(this.activity === "waiting" || this.activity === "generating" || this.activity === "cancelling" ? [this.cancelButton] : []),
      this.settingsButton,
    ]
  }

  private openMenu(): void {
    if (this.disposed) return
    if (this.picker) { this.picker.show(); return }
    const uri = vscode.window.activeTextEditor?.document.uri
    const folder = uri && vscode.workspace.getWorkspaceFolder(uri)
    const target = folder ? vscode.ConfigurationTarget.WorkspaceFolder
      : vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
    const config = vscode.workspace.getConfiguration("codem", uri)
    const picker = vscode.window.createQuickPick<SettingItem>()
    this.picker = picker
    picker.title = `CodeM 补全 · ${folder ? folder.name : target === vscode.ConfigurationTarget.Workspace ? "当前工作区" : "用户设置"}`
    picker.placeholder = "勾选后点击确定保存，Esc 放弃；右上角可手动生成或取消"
    picker.canSelectMany = true
    picker.items = [
      { label: "启用行内补全", description: "总开关", key: "completion.enabled" },
      { label: "自动触发补全", description: "停输入后生成；需要开启总开关", key: "completion.autoTrigger" },
    ]
    picker.selectedItems = picker.items.filter(item => config.get<boolean>(item.key, true))
    picker.buttons = this.buttons()
    let saving = false, closed = false
    const subscriptions = [
      picker.onDidAccept(async () => {
        if (saving || closed) return
        saving = true; picker.busy = true; picker.enabled = false
        const selected = new Set(picker.selectedItems.map(item => item.key))
        try {
          for (const item of picker.items) {
            if (closed || this.disposed) return
            const value = selected.has(item.key)
            if (vscode.workspace.getConfiguration("codem", uri).get<boolean>(item.key, true) !== value) await config.update(item.key, value, target)
          }
          if (!closed) picker.hide()
        } catch {
          void vscode.window.showWarningMessage("补全设置未能全部保存，请检查设置文件后重试。")
        } finally {
          saving = false
          if (!closed) { picker.busy = false; picker.enabled = true }
          this.render()
        }
      }),
      picker.onDidTriggerButton(async button => {
        if (saving || closed) return
        picker.hide()
        if (button === this.generateButton) await vscode.commands.executeCommand("codem.generateCompletion")
        else if (button === this.cancelButton) await vscode.commands.executeCommand("codem.cancelCompletion")
        else await vscode.commands.executeCommand("workbench.action.openSettings", "@id:codem.completion.enabled @id:codem.completion.autoTrigger @id:editor.inlineSuggest.enabled")
      }),
      picker.onDidHide(() => {
        closed = true
        if (this.picker === picker) this.picker = null
        for (const subscription of subscriptions) subscription.dispose()
        picker.dispose()
      }),
    ]
    picker.show()
  }

  dispose(): void {
    this.disposed = true
    this.picker?.hide()
    for (const subscription of this.subscriptions) subscription.dispose()
    this.item.dispose()
  }
}
