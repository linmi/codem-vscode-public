# 原生 CodeM Agent 实验

目标：在 VS Code 原生 Chat 的会话类型菜单选择 CodeM，然后直接发送任务，无需 `@`。这是完整 Core 的第二种界面适配，不是模型供应商，也不替换现有 Webview。当前是实验实现，尚未达到原生界面端到端准出标准。

## 版本与隔离

实验构建使用独立扩展 ID `codem.codem-native-experiment`，产物位于 `apps/vscode/dist/nativeChat/`。正常插件清单不声明 Proposed API，不改变原有启动入口、凭据或用户全局配置。

接口基线：本机 VS Code 1.138.0，提交 `7debcd0e2acdea1c52de81bf9ee1620444407dda`。使用 `chatSessionsProvider` 提案；接口结构从该提交的 `src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts` 核实，最小本地类型位于 `nativeChatApi.ts`。不把当前接口冒充 1.105 稳定 API。不面向 Marketplace 发布。

已核对版本：1.139.0（`2242ebbb54efeeb0129e08e919e7e8d43033cd83`）与 1.139.1（`04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`）的会话提案、`extHostChatSessions.ts` 与会话声明同基线逐行比对，提案只多一个与会话无关的可选字段 `maxContextWindowTokens`，派发器与会话声明不变。激活只接受 `nativeChatApi.ts` 中列出的已核对小版本（1.138.x、1.139.x），其他版本（含 Insiders）拒绝激活并报出当前版本；新版本须先比对上述文件再加入列表。

官方依据：[会话接口](https://github.com/microsoft/vscode/blob/7debcd0e2acdea1c52de81bf9ee1620444407dda/src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts)、[会话声明](https://github.com/microsoft/vscode/blob/7debcd0e2acdea1c52de81bf9ee1620444407dda/src/vs/workbench/contrib/chat/browser/chatSessions/chatSessions.contribution.ts)、[提案使用限制](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)。

## 操作与状态约定（实施前）

- 首次选择：菜单与注册不登录、不启动 Core。显式连接或首次创建会话才校验信任、登录、选择工作区/空间并建立连接；需要登录时提供专门命令。没有自动认证重试。
- 新建：Core 创建 threadId 后才注册可续聊的原生会话。空白输入不调用模型。实验版默认 Core 当前模型、默认审批权限；不继承其他界面的完全访问设置。
- 连续发送：同一 Core threadId，流式文本、工具进度和终态由现有 ChatController 投影。一个实验实例只运行一个前台任务；重复请求和运行中切换被明确拒绝。
- 停止：发送前取消不提交；发送回执未到时记住取消，获得运行身份后发 interrupt。interrupt 回执不代表终态。取消后没有终态时关闭实验连接、报错，不能宣称正常完成。
- 审批/问答：原生 Quick Pick/Input Box 收集 Core 给出的选项，自由文本显式收集。取消、请求过期、停止及关闭均不允许迟到审批；Core/控制器继续校验归属。计划先显示全文，再明确同意或拒绝。
- 失败：展示可读错误，不自动重发。连接失效后显式重连；已提交任务从 Core 历史核对。
- 历史/重载：原生列表来自 Core，内容来自 schema 13 JSONL；不建立第二套消息存储。切换到列表中的历史会话后续聊。完整分页失败保留原生旧视图并报错，不把半份历史表示成完整记录。
- 清理：实验入口单独拥有 controller、原生预览文档、注册和日志；deactivate 等待其关闭。新建/恢复复用已有控制器的订阅、资源和历史生命周期。工作区目录变化使连接失效，不把旧工作区会话转到新目录。
- 首版不迁移全部 Webview 设置面板、附件、会话管理菜单及后台唤醒 UI，不加载独立面板保存的 MCP 配置；未支持的输入必须明确拒绝。

## 昂贵操作与验收

- 菜单注册：0 RPC、0 子进程。
- 首次连接：复用 connectRuntime 的一次认证、空间预检、Core 初始化和模型目录；不读取其他扩展的 SecretStorage。
- 新建：已有连接上一个 thread/start；消息使用一个 turn/start。重复发送不重复连接或初始化。
- 列表：复用现有按页 list/read 名称补齐，刷新重新认证；浏览器视图不写历史。
- 恢复：既有 read/resume/modes/JSONL 链路；JSONL 每页仍走已有认证，不能为了原生界面跳过。
- 取消：最多一个 interrupt，等待真实 turn/completed；超时只回收本实验连接。
- 准出：真实菜单可见并可选择，直接发送进入 Core、流式回复、连续对话、停止及恢复；单元测试覆盖事件竞态、重复请求、取消、错误、过期审批和非法会话身份。单元/集成、模拟、真实 Core、真实 VS Code 分开记录。

## 本地试用

1. 使用 VS Code 1.138.x 或 1.139.x，在仓库根目录运行 `pnpm --filter codem build:native-chat`。
2. 在运行和调试中选择 `CodeM Native Chat (Experimental)`，按 F5。此配置已携带实验扩展路径和 `--enable-proposed-api=codem.codem-native-experiment`。
3. 在开发宿主打开可信的本地工作区，执行 `CodeM Native: 连接并加载会话`；尚未登录时执行 `CodeM Native: 登录并连接`。
4. 在原生 Chat 的会话类型菜单选择 CodeM，输入纯文本任务。入口在会话类型菜单，不是模型菜单；无需输入 `@codem`。

**当前平台前置条件**：原生 Chat 需要存在并选中一个可用模型。VS Code 1.138/1.139 在调用第三方 session requestHandler 前，会通过 `getModelForRequest` 解析原生模型；无可用模型会直接抛出 `Language model unavailable`，请求到不了 CodeM。`supportsAutoModel` 仅解决菜单显示，不能消除此派发要求。实际任务仍由 CodeM Core 当前模型执行，不调用 `request.model.sendRequest`；原生模型菜单的选择不会修改 Core 模型。首版因此尚不能宣称脱离原生模型提供方独立可用。

依据：[请求派发与模型前置检查](https://github.com/microsoft/vscode/blob/7debcd0e2acdea1c52de81bf9ee1620444407dda/src/vs/workbench/api/common/extHostChatSessions.ts#L780)、[默认模型解析](https://github.com/microsoft/vscode/blob/7debcd0e2acdea1c52de81bf9ee1620444407dda/src/vs/workbench/api/common/extHostLanguageModels.ts#L361)。实验未注册虚假的模型或修改 VS Code 本体来绕过此限制。

## 验证记录（2026-09-20）

- 单元/集成：活跃工作区默认测试全部通过；原生适配新增 14 项，覆盖连续发送、开始回执与终态竞态、取消超时、挂起 RPC、重复请求、隔离历史、断连、创建失败、过期审批和幂等关闭。全库 Oxlint、类型检查通过。
- 构建：独立实验产物构建成功，普通插件清单仍不声明 Proposed API。
- 真实 Core：显式运行 `pnpm --filter codem test:live --native-chat`，同一连接连续两轮、真实停止终态、关闭重连、schema 13 历史恢复通过。最近一次耗时：创建 1295ms，两轮分别 1412ms/1412ms，停止测试整轮 6218ms，恢复 1744ms。两轮复用一个连接，恢复创建第二个连接。测试仅使用临时工作区和自己创建的会话，已清理。
- 真实 VS Code：独立实验扩展在 1.138.0 Extension Host 成功激活，controller、participant、content provider 注册无异常。`nativeChatExtensionSmoke.ts` 通过；该宿主 `vscode.lm.selectChatModels({})` 返回 0 个模型。
- 模拟界面：未执行；本 Cycle 不修改 Webview。
- 原生界面操作：**未通过端到端验收**。界面自动化只能绑定原有开发宿主，未能定位独立实验窗口；没有改动或重载原有宿主。模型前置条件也未满足。菜单展开、首次派发、原生审批面板、重载后恢复仍需在满足前置条件的宿主操作验收。

临时实验宿主及验收进程已退出。

## 验证记录（2026-09-26，VS Code 1.139）

稳定版已更新到 1.139.1，原版本门禁使实验扩展在激活时直接抛出“仅针对 VS Code 1.138.x”，原生会话类型不会出现。

- 单元：`nativeChatService.test.ts` 新增版本门禁正反例（1.138.0、1.139.0/1.139.1 接受；1.137、1.140、Insiders 与位数相近的版本拒绝）。
- 真实 VS Code：云端 Linux 容器用 xvfb 启动官方 1.139.1，加载 `dist/nativeChat` 并运行 `nativeChatExtensionSmoke.ts`。修改前激活失败并报出上述错误；修改后激活成功，三个命令注册；该宿主无原生模型（`NATIVE_CHAT_MODELS=0`）。未登录、未连接 Core、未发送任务。
- 原生界面操作：仍**未通过端到端验收**。模型前置条件在 1.139.1 与上游 main 的派发器中都未改变，需在装有原生模型提供方的宿主上操作验收。正常插件和原有开发宿主未关闭。当前机器的 pnpm 12.4.1 启动器存在 ENOEXEC，验证改为用 Node 直接运行同版本 CLI；`check` 的 lint/typecheck/test 分别执行，未修改机器或仓库配置来规避问题。
