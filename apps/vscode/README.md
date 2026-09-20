# CodeM for VS Code

第一版独立客户端，使用现有 `@codem/app-server` 连接已发布的 Core。新写的 Host 和 TypeScript Webview 不依赖历史插件、旧 SDK 或旧 UI。

## 代码组织

Host 按 `chat`、`connection`、`sessionHistory`、`resources`、`integrations`、`panels`、`nativeChat` 分组，Host/Webview 共用代码位于 `src/shared/`。Webview 按功能组织，shadcn 基础组件独立位于 `webview/components/ui/`。目录职责、依赖门禁和迁移验证见[源码组织](../../docs/sourceOrganization.md)。

## 当前功能

- CodeM 活动栏入口、原生标题工具栏与品牌 Logo。
- 独立登录页与账户头像入口；通过现有 CLI 完成浏览器登录，个人页展示认证返回的信息。
- 选择工作区和本次连接的空间，校验 Core 连接与当前模型。
- 底部“本地”右侧以立方体图标显示当前空间，点击立即使用本连接缓存的目录打开菜单，可手动刷新；显示菜单不进行认证或网络请求。切换前验证新空间连接与模型，成功后开始新会话；取消或预检失败保留原会话。运行中禁止切换，不改写 CLI 全局空间选择。
- 单个当前会话的消息发送、真实流式回复、停止、新建会话。
- 发送结果通过独立请求回执确认：未确认时保留草稿，失败不自动重发，发送期间的新编辑不会被旧回执清除。已收到 Core 开始通知但回执失败时继续展示运行状态。
- 对话内显示 Core 提供的思考过程和工具输出：默认紧凑折叠并持续更新，失败时展开，保留手动折叠选择；工具调用和结果按 callId 合并，名称、状态、说明和输出分别展示。历史记录使用相同卡片，默认折叠，失败记录展开。断线或缺少结果时明确显示未完成，不推断工具成功。
- 当前工作区的历史会话列表、恢复续聊、列表分页和加载更早消息。会话工具支持改名、分叉、归档、解除归档、删除和清空上下文，写入前确认目标。
- 会话工具接入原生技能输入、运行中补充指令、旁路提问及取消、Shell 命令和额外工作目录；主动压缩和回退复用 Core 控制轮次及检查点选择。压缩在 Core 0.8.44 存在缺少终态的实测限制，详见[能力接入与验收](../../docs/appServerCapabilities.md)。
- 按需读取技能、运行环境、配置概览、Hooks、插件、权限档案、空间、模型能力和实时快照；展示计划、用量、变更汇总、工具保护与 Hook 结果，原始配置和路径保留在 Host。
- 输入框上方的权限审批、问答及计划确认卡片；审批结果必须仍属于当前运行中的请求。
- VS Code 主题变量、键盘发送、中文输入法保护、窄侧栏、可见焦点与高对比度样式。
- 输入区支持模型、思考强度（low / medium / high / xhigh）、Agent / Plan、默认权限 / 自动审批 / 完全访问切换。选择来自 Webview 内的菜单，模型来自 Core 目录；运行中锁定设置。模型、强度、MCP 通过同一 thread 的 resume 应用于下一轮；权限及计划模式使用 Core revision 校验，失败不会伪装成已生效。
- 附件支持原生选择文件、图片和目录，移除、去重、最多 20 项；发送前重新校验文件，图片最多 20 MiB，不支持图片的模型会明确拒绝。发送失败保留附件，确认发送后清空。
- 资源面板显示文件修改统计，点击可打开只读补丁预览或工作区文件；明确标注部分差异、二进制和缺失预览。打开文件校验真实路径，拒绝越出工作区的符号链接和路径穿越。
- 后台进程每 3 秒刷新，也可手动刷新、查看日志尾部快照、终止进程和清理终端。后台任务唤醒通知单独展示并支持取消；任务 ID 与进程 ID 不混用。Core 发起的后续轮次按正常流式、审批和完成事件展示。
- MCP 支持添加、启用、停用和移除 stdio 服务器，使用绝对可执行文件路径；参数与环境变量通过原生输入收集，配置保存在 VS Code SecretStorage。界面只展示名称。Core 的 `tools/list` 提供基础目录，MCP 工具由模型通过 `tool_search` 按需发现；列表不冒充健康检查，也不支持 Core 尚未提供的 HTTP transport。

文本及代码围栏安全渲染。Core 仍负责保存真实历史，扩展不创建第二套记录。重新打开面板时会在可信工作区内自动连接，并恢复上次空间、模型、思考强度、权限和工作模式；配置按工作区与空间隔离。MCP 继续从 SecretStorage 恢复，历史会话仍从历史列表选择；Webview 隐藏/重建时由 Host 重发当前快照，草稿由 Webview state 保留。

## 原生编辑器与终端工作流

- 编辑器选区右键 **CodeM**：加入上下文、解释、修复、改进。灯泡提供诊断修复与重写动作。捕获未保存的选区及位置，先追加到草稿，再由用户发送。
- **CodeM: 在编辑器标签页打开聊天** / **将聊天移回侧栏**：共用当前会话、草稿和审批，重复打开复用同一个标签页。
- 终端右键 **CodeM**：复制选区加入上下文、加入最近输出、解释命令或分析错误。最近输出要求 Shell Integration，扩展激活前的输出不回溯；每个终端只保留最近命令的 20000 字符，不落盘。选区命令会把所选文本复制到剪贴板。
- **CodeM: 生成行内补全**：连接后在文件光标处手动调用，以原生灰字显示，使用 VS Code 的接受/取消操作。没有自动逐键请求；忙碌时等待当前任务结束。修改文档、移动光标或取消后丢弃结果。
- Git 源代码管理中的 **生成暂存变更的提交说明**：使用暂存差异，生成后填入对应仓库输入框。不会执行提交；取消、暂存变化和输入框编辑均阻止覆盖。无暂存变更时提示先暂存。
- 完整且匹配的文本补丁打开原生只读双栏 Diff，标题注明补丁重建。比较行内容，不比较行尾格式；部分、二进制、缺失或不匹配的内容仍明确显示补丁说明。

默认快捷键：`Ctrl+Alt+M` 聚焦聊天、`Ctrl+K Ctrl+M` 加入选区、聊天内 `Ctrl+Alt+N` 新建会话、`Ctrl+Alt+Space` 手动补全；macOS 将 Ctrl 换为 Cmd。可在 VS Code 键盘快捷方式中修改。设置页提供 `codem.autoConnect`、`codem.chat.sendKey` 和 `codem.completion.enabled`；发送键可选 Enter 或 Ctrl/Cmd+Enter，运行时生效。

实现边界、取消与验证记录见 [原生集成](../../docs/nativeIntegration.md)。

## 开发

在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build:vscode
```

在 VS Code 中选择根目录的 **CodeM VS Code** 调试配置，按 F5。开发宿主中打开 CodeM 面板：未登录时显示居中登录按钮，浏览器授权成功后进入聊天；登录不需要打开文件夹或信任工作区，也不启动 Core。已登录时右上角显示真实头像（图片不可用时回退到姓名首字），点击查看或刷新个人信息。首次打开面板时，已登录且已打开可信文件夹的用户仍按 autoConnect 设置连接；登录后首次发送或显式连接再准备工作区。连接失败保留手动重试入口，不循环重试。工作区未信任时不会启动 Core，授予信任后自动连接。保存的选择仅作用于当前 VS Code 工作区及对应空间，不改写 CLI 的全局空间选择。

`pnpm --filter codem watch` 持续构建；代码更新后使用开发宿主的 Reload Window 重新加载。构建产物在 `dist/`，匹配当前平台的 Core 与认证代理在 `bin/app-server/`，均不提交。此阶段尚未提供 VSIX 打包或发布命令。

## 验证

```bash
pnpm --filter codem test:extension
# 显式真实联调：需要已登录并有可用空间，会消耗一轮模型请求
pnpm --filter codem test:live
# 功能真实联调：附件、同会话设置切换、临时 MCP 实际调用、文件差异与后台进程（三轮模型请求）
pnpm --filter codem test:live --features
# 能力联调：临时工作区、真实 Core 和模型，Headless，不新开 VS Code
pnpm --filter codem test:live --capabilities
# 单独回归文件差异与后台进程（一轮模型请求）
pnpm --filter codem test:live --features --resources
```

先执行构建。常规 smoke 和未带 `--capabilities` / `--headless` 的 live 验证启动真实 VS Code Extension Host，在隔离的临时工作区和用户配置下运行；常规 smoke 不启动 Core，live 模式额外运行应用的连接与聊天控制器。测试工作区的信任开关仅影响该隔离进程，不修改用户设置。macOS 默认定位 `/Applications/Visual Studio Code.app`，其他安装位置或系统设置 `CODEM_VSCODE_EXECUTABLE` 为应用可执行文件路径。

默认 `pnpm check` 不登录、不启动真实模型。原生 smoke 额外校验只读差异预览、日志截断和 MCP 配置读取；`--features` 在一次性工作区创建附件和不含真实凭据的 MCP fixture，并验证实际调用。真实界面的发送、流式文本及停止还应在开发宿主面板内验证；浏览器截图只用于布局检查，不替代 Extension Host 验证。

## 目录与边界

```text
src/              扩展入口、运行时连接、聊天控制器、审批映射、白名单消息
webview/          浏览器端界面与 VS Code 主题样式
assets/           从历史项目复制的 CodeM 素材
scripts/          构建与 Extension Host 启动器
tests/            协议、状态、生命周期及真实联调验证
```

连接与执行前检查 Workspace Trust；路径和认证只存在 Host。Webview 不接收原始 RPC、环境变量和凭据。Core 事件按连接、会话、轮次及 submissionId 关联；停止请求的回执不代表完成，`turn/completed` 才结束运行状态。用户和工具内容使用文本节点；助手 Markdown 经 Marked 解析及 DOMPurify 白名单过滤，不接受模型提供的脚本、样式、图片、表单、命令链接或本地文件链接。

参考：[VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)、[Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)。素材来源与许可证见仓库根目录 [UPSTREAM.md](../../UPSTREAM.md)。

## 历史会话

连接后点击标题栏的历史图标，或运行 `CodeM: 历史会话`。列表限定在当前连接的工作区，按 Core 返回的顺序显示，支持刷新和「加载更多会话」。已归档会话不可直接续聊；通过「会话工具」加载列表并选择目标后解除归档。

选择会话后恢复最近 30 轮，使用原 threadId 继续对话；「加载更早消息」向顶部追加上一页并保留阅读位置。后续轮次沿用界面当前选择的模型、思考强度和 MCP 配置；权限与计划模式以恢复后 Core 返回的状态为准。恢复成功才清理之前会话的附件、差异和后台句柄。

列表走 App Server `thread/list`，每页通过 `thread/read` 并行补齐持久名称（0.8.44 的列表结果不带名称）；恢复通过 `thread/read` 校验工作区后调用 `thread/resume`；消息仅由 `@codem/session-history` 读取 Core schema 13 JSONL。分页游标和历史根目录仅存于 Host，界面发送操作意图与 threadId。每次读取历史前重新检查信任和登录状态，不创建额外历史存储。

生成期间禁止切换、回放或翻页。实时轮次会使旧历史游标失效；完成后在历史浮层点击「重新加载记录」建立新快照。文件变化、损坏、权限或分页错误会保留已有显示并提示重试，不混合不同版本的记录。后台唤醒和断线会取消在途回放，迟到结果不能覆盖实时消息。

关闭窗口后，重新连接并从历史列表选择会话即可恢复；不自动选择上次会话。历史附件只显示数量，历史差异和后台进程不会恢复为可操作的本地句柄。默认检查通过临时 JSONL 和独立 Host fixture 验证，不访问用户历史、不消耗模型请求。

## Synara 聊天界面

以 Synara `33333439c4b9c74d0097bc01196cccc921f67cf3` 的默认 Codex 明暗主题和 comfortable 密度为样式基准。主题值由上游 `buildThemeCssVariables(resolveThemePack(DEFAULT_THEME_STATE, mode), mode)` 计算后提取；布局及排版来自 `composerPickerStyles.ts`、`chatTypography.ts` 和 `index.css`。

- 聊天列最大 736px；正文 12px / 19.5px；用户气泡最大 80%、16px 圆角和 10px / 14px 内边距。
- 输入框 19.2px 圆角、玻璃材质、精确边框及阴影；左右分别为附件/权限和模式/模型/强度/发送，发送按钮 28px。
- 居中空白页、无竖线工具行、图标复制、Markdown 标题/列表/表格/代码块；历史和资源浮层支持 Escape 关闭及焦点恢复。
- 跟随 VS Code 的 light/dark 分类选择 Synara 配色；高对比度模式使用 VS Code 颜色，保留键盘焦点及减少动态效果设置。

当前对齐范围是 VS Code 聊天 Webview 的已有表面。品牌、中文文案和 VS Code 外壳保留 CodeM；模型选择、审批、问答和计划确认已使用 Synara 样式的 Webview 面板，由 Host 保持请求与选项校验，未移植 Synara 桌面项目侧栏、分屏工作区及其全部菜单。不能据此宣称完整桌面产品已像素级 1:1。详细来源、映射与验证见 [synaraStyleAlignment.md](../../docs/synaraStyleAlignment.md)。

本轮 Synara 交互实施与剩余差异见 [逐项实施记录](../../docs/synaraImplementation.md)。现在包含执行分组、初始化及恢复占位、时间线等待、强度滑杆、追问返回、计划反馈、附件卡片、常用代码高亮及历史搜索。 `/files`、`/model`、`/mode`、`/history` 是本地界面快捷入口，不是 Core 命令目录。图片预览仅接受不超过 512 KiB 的受支持 raster 数据，较大图片继续发送原图。

## 样式场景预览

构建后运行 `node --experimental-strip-types apps/vscode/tests/webviewPreview.ts`（仓库根目录），打开 http://127.0.0.1:4318/。顶部选择器提供 24 个状态、菜单和内容场景，支持浅色/深色及重置。场景与主题保存在 URL，可直接分享具体预览链接。所有数据与操作均为独立模拟，不连接 Core；该工具栏只存在于预览服务中，不进入插件。

连接与空间选择的调用次数、性能实测和验收边界见 [治理记录](../../docs/connectionGovernance.md)。
