# 历史 VS Code 插件点位清单

用于后续功能规划、入口设计和迁移核对。本文记录历史事实，不构成新客户端的必做需求，也不代表历史功能当前可运行。

## 来源与统计口径

- 整理日期：2026-09-19。
- 历史插件：CodeM `0.1.14`，清单声明 VS Code `^1.105.1`。
- 原始项目提交：`c389c6304f0108cd50fd31ad3b79bd5402f28ad2`；归档提交：`904dddd3ccd5125bc34b31fed3488795c66036f6`。
- 核对时仓库 HEAD：`c37e5884c7c508d33d52ade401a9b35d1323e666`。
- 主要依据：[历史 package.json](../history/apps/vscode/package.json)、[扩展入口](../history/apps/vscode/src/extension.ts)。仅静态读取，没有安装、构建或启动历史项目。
- “扩展点类别”按 `contributes` 的一级键计数；“命令”按 `contributes.commands` 的声明计数；菜单和快捷键按配置条目计数。
- 命令、按钮、快捷键和设置会交叉关联，不能相加作为独立业务功能总数。运行时注册能力另列，不并入 70 个声明命令。

## 总览

| 扩展点 | 数量 | 用途 |
|---|---:|---|
| `commands` | 70 | 供菜单、快捷键、命令面板及程序调用的操作入口 |
| `menus` | 9 个键、27 条 | 包含 7 个内置菜单位置、2 个自定义子菜单内容；6 条是隐藏命令面板入口的规则 |
| `keybindings` | 42 | 41 条绑定和 1 条移除原生绑定的规则 |
| `configuration` | 34 个属性 | 注册 VS Code 设置项 |
| `viewsContainers` | 1 | 活动栏 CodeM 容器 |
| `views` | 1 | CodeM 侧边栏 Webview |
| `submenus` | 2 | 编辑器和终端的 CodeM 子菜单 |
| `taskDefinitions` | 1 | `codem-worktree-setup` 任务声明，包含脚本字段 |
| `icons` | 1 | `codem-logo` 图标字体定义 |
| `configurationDefaults` | 1 个设置键 | 覆盖 `files.watcherExclude`，增加两个 Worktree 目录排除模式 |

共 10 类扩展声明。`activationEvents` 不属于 `contributes`：历史清单另有 `onStartupFinished` 和 `onUri` 两个激活事件。

## 命令清单（70 个）

下表说明命令的设计用途和已检查的 Host 处理路径。除明确说明的占位、转发和旧连接依赖外，命令注册也不等于已经完成端到端可用性验证。

### 聊天与任务（8 个）

| 命令 ID | 用途 |
|---|---|
| `codem.plusButtonClicked` | 新建任务 |
| `codem.historyButtonClicked` | 打开任务历史 |
| `codem.openInTab` | 在编辑器标签页打开聊天 |
| `codem.focusChatInput` | 聚焦聊天输入框 |
| `codem.toggleChatSearch` | 开关聊天搜索 |
| `codem.cycleAgentMode` | 切换到下一个 Agent 模式 |
| `codem.cyclePreviousAgentMode` | 切换到上一个 Agent 模式 |
| `codem.selectPermissionMode` | 打开当前线程的权限模式选择 |

### 账号、空间与设置（6 个）

| 命令 ID | 用途 |
|---|---|
| `codem.selectSpace` | 选择 CodeM 空间；影响新建和重新打开的任务，要求可信工作区及已打开目录 |
| `codem.profileButtonClicked` | 在编辑器区域打开个人资料页 |
| `codem.signIn` | 登录或注册 |
| `codem.signOut` | 退出登录 |
| `codem.refreshAuthentication` | 刷新认证状态 |
| `codem.settingsButtonClicked` | 在编辑器区域打开设置页，可携带设置标签和项目参数 |

### Agent Manager（32 个）

| 命令 ID | 用途 |
|---|---|
| `codem.agentManagerOpen` | 打开 Agent Manager 面板 |
| `codem.agentManager.previousSession` | 切换上一会话 |
| `codem.agentManager.nextSession` | 切换下一会话 |
| `codem.agentManager.previousTab` | 切换上一标签页 |
| `codem.agentManager.nextTab` | 切换下一标签页 |
| `codem.agentManager.previousTerminal` | 切换上一终端 |
| `codem.agentManager.nextTerminal` | 切换下一终端 |
| `codem.agentManager.search` | 搜索 Worktree 和会话 |
| `codem.agentManager.showTerminal` | 打开或聚焦终端，目的地受设置及面板选择影响 |
| `codem.agentManager.runScript` | 运行配置的脚本 |
| `codem.agentManager.toggleDiff` | 开关差异面板 |
| `codem.agentManager.showShortcuts` | 显示快捷键说明 |
| `codem.agentManager.newTab` | 新建标签页 |
| `codem.agentManager.newTerminalTab` | 新建终端标签页 |
| `codem.agentManager.newSideTerminal` | 新建侧栏终端标签页 |
| `codem.agentManager.closeTab` | 关闭标签页 |
| `codem.agentManager.newWorktree` | 打开新建 Worktree 配置流程 |
| `codem.agentManager.quickWorktree` | 快速创建 Worktree |
| `codem.agentManager.openWorktree` | 打开 Worktree |
| `codem.agentManager.updateFromBase` | 从基准分支更新 Worktree |
| `codem.agentManager.openPR` | 打开 Pull Request |
| `codem.agentManager.closeWorktree` | 关闭 Worktree |
| `codem.agentManager.advancedWorktree` | 打开高级 Worktree 配置入口；在命令面板隐藏 |
| `codem.agentManager.jumpTo1` | 跳转第 1 项 |
| `codem.agentManager.jumpTo2` | 跳转第 2 项 |
| `codem.agentManager.jumpTo3` | 跳转第 3 项 |
| `codem.agentManager.jumpTo4` | 跳转第 4 项 |
| `codem.agentManager.jumpTo5` | 跳转第 5 项 |
| `codem.agentManager.jumpTo6` | 跳转第 6 项 |
| `codem.agentManager.jumpTo7` | 跳转第 7 项 |
| `codem.agentManager.jumpTo8` | 跳转第 8 项 |
| `codem.agentManager.jumpTo9` | 跳转第 9 项 |

### 侧边栏标题栏转发入口（5 个）

| 命令 ID | 用途 |
|---|---|
| `codem.sidebarTitle.plusButtonClicked` | 转发到 `codem.plusButtonClicked`，不增加独立业务能力 |
| `codem.sidebarTitle.agentManagerOpen` | 转发到 `codem.agentManagerOpen`，不增加独立业务能力 |
| `codem.sidebarTitle.historyButtonClicked` | 转发到 `codem.historyButtonClicked`，不增加独立业务能力 |
| `codem.sidebarTitle.profileButtonClicked` | 转发到 `codem.profileButtonClicked`，不增加独立业务能力 |
| `codem.sidebarTitle.settingsButtonClicked` | 转发到 `codem.settingsButtonClicked`，不增加独立业务能力 |

### 编辑器代码操作（4 个）

| 命令 ID | 用途 |
|---|---|
| `codem.explainCode` | 将选中代码及位置组成解释请求并触发聊天任务 |
| `codem.fixCode` | 将代码、位置及诊断组成修复请求并触发聊天任务 |
| `codem.improveCode` | 将选中代码组成改进请求并触发聊天任务 |
| `codem.addToContext` | 把代码与位置追加到聊天输入框，供用户继续编辑 |

### 终端辅助（4 个）

| 命令 ID | 用途 |
|---|---|
| `codem.terminalAddToContext` | 将选区或最近终端内容追加到聊天输入框 |
| `codem.terminalFixCommand` | 根据选区或最近一条终端内容触发修复任务 |
| `codem.terminalExplainCommand` | 根据选区或最近一条终端内容触发解释任务 |
| `codem.generateTerminalCommand` | 先收集自然语言需求，再发起生成终端命令的聊天任务；入口本身不执行生成的命令 |

### 代码补全（4 个）

| 命令 ID | 用途 |
|---|---|
| `codem.autocomplete.generateSuggestions` | 手动请求补全建议 |
| `codem.autocomplete.cancelSuggestions` | 隐藏行内建议并清理建议状态 |
| `codem.autocomplete.nextEdit.acceptOrJump` | 跳到预测修改位置或接受修改 |
| `codem.autocomplete.nextEdit.dismiss` | 清除待处理的下一处修改建议 |

### Git 与变更（2 个）

| 命令 ID | 用途 |
|---|---|
| `codem.generateCommitMessage` | 请求生成提交说明并填入 Git 输入框；不直接提交；仍依赖已退役旧连接，见限制章节 |
| `codem.showChanges` | 打开差异查看器，支持命令参数选择展示内容 |

### 项目记忆（2 个）

| 命令 ID | 用途 |
|---|---|
| `codem.showMemory` | 原计划查看项目记忆；当前处理器仅显示尚未迁移提示 |
| `codem.toggleMemory` | 原计划开关项目记忆；当前处理器仅显示尚未迁移提示 |

### 保持唤醒（1 个）

| 命令 ID | 用途 |
|---|---|
| `codem.toggleCaffeination` | 开关防休眠；平台不支持时提示错误 |

### 维护与诊断（2 个）

| 命令 ID | 用途 |
|---|---|
| `codem.takeHeapSnapshot` | 请求后端生成堆快照；仍依赖已退役旧连接，见限制章节 |
| `codem.reload` | 调用聊天 Provider 的重新加载流程，命令标题为 Reload Config and Skills |

### 处理路径与源码定位

- 主界面、标题栏转发、Agent Manager、模式、唤醒和 URI：[extension.ts](../history/apps/vscode/src/extension.ts)。不少入口只向 Webview 发出 `action`，其后续业务仍需检查对应前端处理器。
- 空间选择：[spaces-ui.ts](../history/apps/vscode/src/services/app-server/spaces-ui.ts)。
- 编辑器动作：[register-code-actions.ts](../history/apps/vscode/src/services/code-actions/register-code-actions.ts)。解释、修复、改进发往侧边栏；加入上下文、聚焦和搜索会根据当前活动面板选择目标。
- 终端动作：[register-terminal-actions.ts](../history/apps/vscode/src/services/code-actions/register-terminal-actions.ts)。优先使用终端选区，没有选区时尝试读取最近内容；无内容时提示用户。
- 补全：[autocomplete/index.ts](../history/apps/vscode/src/services/autocomplete/index.ts)。
- 提交说明：[commit-message/index.ts](../history/apps/vscode/src/services/commit-message/index.ts)。
- 堆快照：[heap-snapshot.ts](../history/apps/vscode/src/commands/heap-snapshot.ts)。

## 菜单挂载与界面入口

活动栏容器为 `codem-ActivityBar`，其中声明的 Webview 是 `codem.SidebarProvider`。编辑器标签页、Agent Manager 等面板由运行时创建，不计入清单的 1 个 `views`。

以下完整保留 27 条菜单配置；`group` 决定分组或排序，`when` 限定展示条件。`when: false` 的命令面板规则用于隐藏入口。

| 菜单位置 | 命令或子菜单 | group | when |
|---|---|---|---|
| `commandPalette` | `codem.sidebarTitle.plusButtonClicked` | — | `false` |
| `commandPalette` | `codem.sidebarTitle.historyButtonClicked` | — | `false` |
| `commandPalette` | `codem.sidebarTitle.agentManagerOpen` | — | `false` |
| `commandPalette` | `codem.agentManager.advancedWorktree` | — | `false` |
| `commandPalette` | `codem.sidebarTitle.profileButtonClicked` | — | `false` |
| `commandPalette` | `codem.sidebarTitle.settingsButtonClicked` | — | `false` |
| `view/title` | `codem.sidebarTitle.plusButtonClicked` | `navigation@0` | `view == codem.SidebarProvider && !codem.isCursor` |
| `view/title` | `codem.sidebarTitle.historyButtonClicked` | `navigation@1` | `view == codem.SidebarProvider && !codem.isCursor` |
| `view/title` | `codem.sidebarTitle.agentManagerOpen` | `navigation@2` | `view == codem.SidebarProvider && !codem.isCursor` |
| `view/title` | `codem.sidebarTitle.profileButtonClicked` | `navigation@5` | `view == codem.SidebarProvider && !codem.isCursor` |
| `view/title` | `codem.sidebarTitle.settingsButtonClicked` | `navigation@6` | `view == codem.SidebarProvider && !codem.isCursor` |
| `scm/title` | `codem.generateCommitMessage` | `navigation` | `scmProvider == git` |
| `scm/input` | `codem.generateCommitMessage` | `navigation` | `scmProvider == git` |
| `editor/title` | `codem.openInTab` | `navigation` | `true` |
| `editor/title` | `codem.plusButtonClicked` | `navigation@0` | `activeWebviewPanelId == codem.TabPanel && !codem.isCursor` |
| `editor/title` | `codem.historyButtonClicked` | `navigation@1` | `activeWebviewPanelId == codem.TabPanel && !codem.isCursor` |
| `editor/title` | `codem.profileButtonClicked` | `navigation@2` | `activeWebviewPanelId == codem.TabPanel && !codem.isCursor` |
| `editor/title` | `codem.settingsButtonClicked` | `navigation@3` | `activeWebviewPanelId == codem.TabPanel && !codem.isCursor` |
| `editor/context` | `codem.editorContextMenu` | `1_codem` | — |
| `codem.editorContextMenu` | `codem.explainCode` | `1_actions@1` | — |
| `codem.editorContextMenu` | `codem.fixCode` | `1_actions@2` | — |
| `codem.editorContextMenu` | `codem.improveCode` | `1_actions@3` | — |
| `codem.editorContextMenu` | `codem.addToContext` | `1_actions@4` | — |
| `terminal/context` | `codem.terminalContextMenu` | `2_codem` | — |
| `codem.terminalContextMenu` | `codem.terminalAddToContext` | `1_actions@1` | — |
| `codem.terminalContextMenu` | `codem.terminalFixCommand` | `1_actions@2` | — |
| `codem.terminalContextMenu` | `codem.terminalExplainCommand` | `1_actions@3` | — |

`codem.editorContextMenu` 和 `codem.terminalContextMenu` 是自定义子菜单内容，不是两个额外的 VS Code 内置菜单位置。两个子菜单的显示名称均为 CodeM。

## 快捷键清单（42 条）

按历史清单原样记录。默认键列采用 `key`，macOS 列采用 `mac`，没有单独覆盖时沿用 `key`。未声明 `when` 不代表命令一定能在所有状态下完成业务操作。连续按键例如 `ctrl+k ctrl+a` 为两段组合键。

| 命令 | 默认键 | macOS | when |
|---|---|---|---|
| `codem.focusChatInput` | `ctrl+shift+a` | `cmd+shift+a` | — |
| `codem.selectPermissionMode` | `ctrl+alt+a` | `cmd+alt+a` | — |
| `codem.generateTerminalCommand` | `ctrl+shift+g` | `cmd+shift+g` | — |
| `-workbench.actions.view.problems` | `ctrl+shift+m` | `cmd+shift+m` | — |
| `codem.agentManagerOpen` | `ctrl+shift+m` | `cmd+shift+m` | — |
| `codem.addToContext` | `ctrl+k ctrl+a` | `cmd+k cmd+a` | `editorTextFocus && editorHasSelection` |
| `codem.agentManager.previousSession` | `ctrl+alt+up` | `cmd+alt+up` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.nextSession` | `ctrl+alt+down` | `cmd+alt+down` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.previousTab` | `ctrl+alt+left` | `cmd+alt+left` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.nextTab` | `ctrl+alt+right` | `cmd+alt+right` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.previousTerminal` | `ctrl+shift+[` | `cmd+shift+[` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.nextTerminal` | `ctrl+shift+]` | `cmd+shift+]` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.search` | `ctrl+f` | `cmd+f` | `activeWebviewPanelId == 'codem.AgentManagerPanel' && !terminalFocus` |
| `codem.agentManager.showTerminal` | `ctrl+/` | `cmd+/` | `activeWebviewPanelId == 'codem.AgentManagerPanel' && !codem.sidebarFocused` |
| `codem.agentManager.runScript` | `ctrl+e` | `cmd+e` | `activeWebviewPanelId == 'codem.AgentManagerPanel' && (isMac \|\| !terminalFocus)` |
| `codem.agentManager.toggleDiff` | `ctrl+d` | `cmd+d` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.showShortcuts` | `ctrl+shift+/` | `cmd+shift+/` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.newTab` | `ctrl+t` | `cmd+t` | `activeWebviewPanelId == 'codem.AgentManagerPanel' && !codem.agentManagerSideTerminalFocused` |
| `codem.agentManager.newTerminalTab` | `ctrl+shift+t` | `cmd+shift+t` | `activeWebviewPanelId == 'codem.AgentManagerPanel' && !codem.agentManagerSideTerminalFocused` |
| `codem.agentManager.newSideTerminal` | `ctrl+t` | `cmd+t` | `activeWebviewPanelId == 'codem.AgentManagerPanel' && codem.agentManagerSideTerminalFocused` |
| `codem.agentManager.closeTab` | `ctrl+w` | `cmd+w` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.newWorktree` | `ctrl+n` | `cmd+n` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.quickWorktree` | `ctrl+shift+n` | `cmd+shift+n` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.openWorktree` | `ctrl+shift+o` | `cmd+shift+o` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.openPR` | `ctrl+shift+r` | `cmd+shift+r` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.closeWorktree` | `ctrl+shift+w` | `cmd+shift+w` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.jumpTo1` | `ctrl+1` | `cmd+1` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.jumpTo2` | `ctrl+2` | `cmd+2` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.jumpTo3` | `ctrl+3` | `cmd+3` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.jumpTo4` | `ctrl+4` | `cmd+4` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.jumpTo5` | `ctrl+5` | `cmd+5` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.jumpTo6` | `ctrl+6` | `cmd+6` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.jumpTo7` | `ctrl+7` | `cmd+7` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.jumpTo8` | `ctrl+8` | `cmd+8` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.agentManager.jumpTo9` | `ctrl+9` | `cmd+9` | `activeWebviewPanelId == 'codem.AgentManagerPanel'` |
| `codem.cycleAgentMode` | `ctrl+.` | `cmd+.` | `codem.sidebarFocused \|\| activeWebviewPanelId == 'codem.AgentManagerPanel' \|\| activeWebviewPanelId == 'codem.TabPanel'` |
| `codem.cyclePreviousAgentMode` | `ctrl+shift+.` | `cmd+shift+.` | `codem.sidebarFocused \|\| activeWebviewPanelId == 'codem.AgentManagerPanel' \|\| activeWebviewPanelId == 'codem.TabPanel'` |
| `codem.autocomplete.cancelSuggestions` | `escape` | `escape` | `editorTextFocus && !editorTabMovesFocus && !inSnippetMode && codem.autocomplete.hasSuggestions` |
| `codem.autocomplete.generateSuggestions` | `ctrl+l` | `cmd+l` | `editorTextFocus && !editorTabMovesFocus && !inSnippetMode && codem.autocomplete.enableSmartInlineTaskKeybinding && !github.copilot.completions.enabled` |
| `codem.autocomplete.showIncompatibilityExtensionPopup` | `ctrl+l` | `cmd+l` | `editorTextFocus && !editorTabMovesFocus && !inSnippetMode && codem.autocomplete.enableSmartInlineTaskKeybinding && github.copilot.completions.enabled` |
| `codem.autocomplete.nextEdit.acceptOrJump` | `tab` | `tab` | `editorTextFocus && !editorTabMovesFocus && !inSnippetMode && !suggestWidgetVisible && codem.nextEdit.hasPendingSuggestion` |
| `codem.autocomplete.nextEdit.dismiss` | `escape` | `escape` | `editorTextFocus && !editorTabMovesFocus && !inSnippetMode && codem.nextEdit.hasPendingSuggestion` |

注意：

- `-workbench.actions.view.problems` 是移除原生绑定的规则，不是 CodeM 功能命令。对应组合键绑定到了 Agent Manager。
- `codem.autocomplete.showIncompatibilityExtensionPopup` 有快捷键并在运行时注册，但不在 `contributes.commands` 的 70 个声明中。它在启用智能补全快捷键且 Copilot 补全开启时显示兼容性提示。
- 同一组合键可由不同 `when` 分流，例如新建标签页与侧栏终端，以及普通建议与 Next Edit 的 Escape 行为。

## 设置项清单（34 项）

以下“用途”依据清单描述，默认值是历史事实，不作为新客户端的默认值决策；没有 `default` 时记为“未声明”，运行时可能自行解释。设置存在也不证明相应功能已完成迁移。

| 设置键 | 默认值 | 用途 |
|---|---|---|
| `codem.language` | `""` | 界面语言；空字符串跟随 VS Code |
| `codem.languageCommitMessage` | `"sync"` | 提交说明语言；sync 跟随 CodeM 界面 |
| `codem.model.providerID` | `"kilo"` | 新会话默认模型供应商 |
| `codem.model.modelID` | `"kilo-auto/free"` | 新会话默认模型 |
| `codem.autocomplete.model` | 未声明 | 行内补全模型 |
| `codem.autocomplete.provider` | 未声明 | 行内补全供应商 |
| `codem.autocomplete.enableAutoTrigger` | `true` | 自动触发行内补全 |
| `codem.autocomplete.enableSmartInlineTaskKeybinding` | `false` | 启用智能行内任务快捷键 |
| `codem.autocomplete.enableChatAutocomplete` | `false` | 聊天输入框补全 |
| `codem.agentManager.autoBranchNaming` | `true` | 根据任务自动命名 Agent Manager 分支 |
| `codem.agentManager.branchPrefix` | `""` | 自动命名分支的前缀 |
| `codem.experimental.multiProject` | `false` | Agent Manager 多仓库项目管理 |
| `codem.experimental.browserAutomation` | `false` | 实验性浏览器面板与 browser_open 工具 |
| `codem.experimental.claudeMigration` | `false` | 一次性导入支持的 Claude 全局指令、简单 Skills 和禁用的 MCP 定义 |
| `codem.agentManager.terminalButtonDestination` | `"agentManager"` | Agent Manager 终端按钮的初始目的地；面板已记住的选择优先 |
| `codem.indexing.showButtonWhenDisabled` | `true` | 索引禁用时仍显示索引按钮 |
| `codem.claudeCodeCompat` | `false` | 加载 Claude 配置目录中的指令和 Skills |
| `codem.extraCaCerts` | `""` | 后端 HTTPS 使用的额外 PEM CA 证书路径 |
| `codem.intelligence` | `"medium"` | 未显式选择时的默认推理强度 |
| `codem.permissionMode` | `"auto"` | 新线程初始权限模式；已有线程保留 Core 管理的模式 |
| `codem.maxCost` | `0` | 会话费用超额提醒阈值（美元）；0 禁用，属于提醒而非硬限额 |
| `codem.fontSize` | `13` | Webview 字号（像素） |
| `codem.browserAutomation.useSystemChrome` | `true` | 浏览器自动化是否使用系统 Chrome |
| `codem.attention.enabled` | `false` | 完成、出错或需要输入时播放声音 |
| `codem.attention.notifications` | `false` | VS Code 通知 |
| `codem.attention.OSNotifications` | `false` | VS Code 不活跃时的系统通知 |
| `codem.attention.sound` | `"default"` | 提示音选择 |
| `codem.showTaskTimeline` | `true` | 聊天头部显示任务时间线 |
| `codem.showTokenThroughput` | `true` | 显示每秒 Token 吞吐量 |
| `codem.showAutoApprovalReason` | `true` | 显示工具自动批准原因 |
| `codem.chat.shiftTabCyclesVariant` | `true` | Shift+Tab 是否切换推理强度 |
| `codem.agentManager.pushFixes` | `true` | PR 修复或从基准更新后请求 Agent 提交并推送；仍受权限提示约束 |
| `codem.agentWorkStyle` | `"unset"` | Agent 工作风格偏好 |
| `codem.diff.renderMarkdown` | `false` | 差异查看器默认渲染 Markdown |

## 其他声明

- **任务定义**：`codem-worktree-setup` 声明 `script: string`，用于表达初始化脚本。仅凭此声明不能认定 Task Provider 或完整执行链存在；本次未在历史插件 `src/` 中找到对应 `registerTaskProvider` 注册。
- **图标**：`codem-logo` 使用 `assets/icons/codem-icon-font.woff2` 中的字形；活动栏另外引用明暗主题 SVG。
- **默认配置覆盖**：`files.watcherExclude` 增加 `**/.kilo/worktrees/**` 与 `**/.kilocode/worktrees/**` 两个排除模式，减少文件监听范围；不代表删除、隐藏文件或忽略 Git 跟踪。

## 清单之外的运行时接入（补充，非穷尽）

这些能力解释了为什么只数 `contributes` 无法覆盖整个插件。它们不纳入前述 70 个声明命令，也不直接推导为新客户端需求。

| 接入 | 用途与证据 |
|---|---|
| 独立 Webview 面板 | 聊天标签页、Agent Manager、设置、个人资料、文档、差异、单文件审批差异、只读子 Agent 会话；见 [extension.ts](../history/apps/vscode/src/extension.ts)、[DiffVirtualProvider.ts](../history/apps/vscode/src/DiffVirtualProvider.ts) |
| 面板恢复注册 | 恢复聊天、Agent Manager、设置、个人资料和差异面板；文档及子 Agent 面板的恢复处理会关闭旧面板，不能一概称为恢复会话 |
| 状态栏 | CodeM 空间、补全状态、远程连接状态；见 [spaces-ui.ts](../history/apps/vscode/src/services/app-server/spaces-ui.ts)、[AutocompleteStatusBar.ts](../history/apps/vscode/src/services/autocomplete/AutocompleteStatusBar.ts)、[RemoteStatusService.ts](../history/apps/vscode/src/services/RemoteStatusService.ts) |
| Code Actions | 编辑器灯泡动作和补全动作；注册入口见 [extension.ts](../history/apps/vscode/src/extension.ts) 与 [autocomplete/index.ts](../history/apps/vscode/src/services/autocomplete/index.ts) |
| 行内补全 Provider | 普通文本及 Notebook 补全注册；见 [AutocompleteServiceManager.ts](../history/apps/vscode/src/services/autocomplete/AutocompleteServiceManager.ts) |
| URI 处理器 | 保留 `/kilocode/s/<sessionId>`、`/kilocode/switch`、`/kilocode/model` 路径处理入口；存在旧命名和后端依赖，需单独评估 |
| 未在 commands 声明的内部命令 | 例如 `codem.openIndexingSettings`、`codem.toggleRemote`、`codem.openSubAgentViewer`、补全重载及接受回调；注册源码不等于命令面板公开入口 |

## 已知限制与后续使用方法

### 已有证据的限制

1. **项目记忆是占位入口**：`showMemory`、`toggleMemory` 的处理器仅显示“尚未迁移到 CodeM App Server: memory”；内部索引设置命令也只显示迁移提示。
2. **旧连接已经退役**：[connection-service.ts](../history/apps/vscode/src/services/cli-backend/connection-service.ts) 的 `getClientAsync()` 只返回已注入且已连接的客户端，否则抛出迁移错误；不会启动旧 `kilo serve`。测试注入不能证明生产可用。
3. **提交说明和堆快照仍依赖旧连接**：两个命令都调用上述 `getClientAsync()`。其界面入口和历史业务实现仍在，但不能标记为完成 App Server 迁移。其他旧连接调用方未在本次逐一审计。
4. **重复入口不是独立功能**：5 个 `sidebarTitle.*` 全部转发；9 个 `jumpTo1`～`jumpTo9` 是同一导航能力的不同目标；Git 的两个菜单挂载复用同一提交说明命令。
5. **只验证静态事实**：本文没有对历史 UI、后端业务、外部账号或所有 34 项设置的实际生效情况做运行验收。

### 用于新客户端规划时

每次选择一个业务能力，建立如下记录；先确认产品需求，再选择适合新界面的入口：

| 字段 | 应填写内容 |
|---|---|
| 历史依据 | 本文命令 ID、设置键、入口与源码链接 |
| 用户目标 | 用户想完成的操作及其成功结果 |
| 取舍 | 待决定／保留／重新设计／不迁移；由当前需求确定，不从历史自动继承 |
| 新入口 | 命令、工具栏、原生菜单、快捷键或界面内部操作 |
| 责任边界 | Host 平台适配、共享协议、App Server 服务或界面展示 |
| 外部约束 | 工作区信任、账号权限、公开命令或 URI、持久数据及独立消费者 |
| 验收 | 主要成功路径、错误提示、取消、无活动任务或无选区、焦点与快捷键冲突等适用条件 |
| 状态与证据 | 未开始／实现中／已验证，并附代码与验证结果；入口存在不能作为完成依据 |

实现时遵守活跃工作区规则：平台权限、工作区信任、凭据保护由应用负责；实时通信通过 Core App Server stdio；Core 拥有 threadId，`turn/completed` 是实时终态依据，JSONL schema 13 是持久历史来源。不要直接依赖 `history/`，也不要把旧 REST/SSE 连接、旧框架或全部历史设置整包迁入。

### 更新与核对

当需要重新统计时，显式读取 `history/apps/vscode/package.json`，分别核对：

- `Object.keys(contributes).length` → 10。
- `contributes.commands.length` → 70，命令章节应逐项覆盖且不重复。
- `Object.keys(contributes.menus).length` → 9；各数组长度之和 → 27。
- `contributes.keybindings.length` → 42，包括 1 条以 `-` 开头的移除规则。
- `Object.keys(contributes.configuration.properties).length` → 34。

如来源发生变化，更新来源提交、数量、逐项清单和限制说明；新客户端的实现进度应独立记录，避免改写本文的历史事实。
