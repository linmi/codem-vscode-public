# VS Code 应用目录组织

## 首次目录迁移：边界与不变量

现状：Host 功能文件平铺在 `src/`，Webview 状态与视图平铺在 `webview/`，业务组件和 shadcn 基础组件混在 `components/`。本轮按现有职责迁移 VS Code 应用内部路径，不修改业务规则、消息协议、状态所有权、保存范围或清理时机，不移动公共包或历史快照。

首次启动、重复操作、取消、失败重试、重载和工作区/空间/会话切换继续执行原有实现；输入区行为和所有权见 `qualityGates.md`。没有新增认证、网络、RPC、子进程或缓存。验证重点是路径解析、两种扩展构建、Webview 样式扫描、实际展开的菜单以及既有生命周期测试。

JetBrains 应用在 `apps/jetbrains/`：`core`/`account`/`session`/`history` 是无 IDE 依赖的领域层，`ide`/`webview` 提供端口，`src/plugin/kotlin` 才引用 IntelliJ/JCEF。测试在应用根 `tests/`。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `apps/vscode/src/extension.ts` | 正式扩展入口与组装 |
| `src/chat/` | 聊天协调器、界面容器、HTML 与 Host 展示投影 |
| `src/connection/` | 独立账户认证与展示状态、连接、空间目录、连接偏好和 MCP 配置 |
| `src/sessionHistory/` | 历史读取、列表、正文搜索租约及历史消息投影 |
| `src/plugins/` | 插件管理操作、取消/核对状态和不透明安装句柄；不拥有聊天连接或文件路径 UI |
| `src/resources/` | 文件、附件、产物句柄和差异内容 |
| `src/integrations/` | 编辑器、终端、Git、补全及其他 VS Code 能力适配 |
| `src/integrations/nextEdit/` | 当前文件的下一处修改预测、严格原文锚点、原生展示与接受生命周期；不持有聊天状态 |
| `src/panels/` | Host 交互面板、审批转发和设置选择 |
| `src/nativeChat/` | 原生 Chat 实验入口及适配；不混入正式扩展入口 |
| `src/shared/` | Host/Webview 共用的消息契约、编辑器上下文、账户类型和已发布快照的冻结规则；无平台运行时 |
| `webview/main.ts` | Webview 入口：设置 CSP nonce，经 Host 桥挂载 `@codem/ui` |
| `webview/host/` | 把 VS Code 分条消息收成共享快照；不放界面 |
| `webview/styles.css` | 样式入口：引入 `@codem/ui/styles.css`，只追加 VS Code 主题桥接 |
| `tests/`、`scripts/` | 包根目录的测试、fixture 与构建/验收脚本 |

聊天界面、shadcn 基础组件（`packages/ui/src/components/ui/`）和全部界面样式（`packages/ui/src/styles/`）归 `@codem/ui`，VS Code 与 JetBrains 共用；`apps/vscode/webview/` 不再保存界面或样式副本。

## 依赖与门禁

入口组合功能目录；Webview 只能通过 `src/shared/` 使用 Host/Webview 共用代码，不能引用 Host 功能实现。共享契约可以引用无运行时依赖的 `@codem/protocol`，不能反向引用 Host、Webview 或平台运行时。shadcn 基础组件及其业务边界由 `@codem/ui` 的架构规则约束。功能目录可显式依赖相关功能，不以目录移动冒充已消除 Controller 的所有耦合。

目录门禁检查入口目录不再平铺实现、功能目录有明确归属，并拒绝在 `webview/` 下重建组件、输入区或样式副本目录；样式门禁要求 `dist/webview.css` 等于共享样式编译结果加 `body.vscode-*` 限定的桥接规则；依赖检查覆盖运行时解析与静态类型导入，规则自身有正反向测试。新增职责目录需同步说明职责并调整门禁，而不是不断增加根目录例外。

## 首次目录迁移验收记录

- 本轮迁移 84 个现有文件，没有旧路径转发文件，也没有新增 barrel 导出或生产依赖。逐文件对照迁移前内容：除相对导入外，唯一额外的生产内容变化为 Tailwind 的 `@source` 扫描范围；现在扫描整个 Webview 功能目录，并继续扫描预览导航。
- 已同步正式扩展、原生 Chat 实验入口、测试 import 和嵌入 esbuild 的测试入口字符串、类型检查、Oxlint、shadcn 配置、样式入口及来源记录。测试继续留在包根 `tests/`。
- 单元/集成与静态检查：`pnpm check` 通过；`pnpm test:architecture` 已包含目录门禁并通过；新增测试拒绝入口目录平铺、无归属目录、Webview 引用 Host、共享契约反向引用功能、基础组件引用业务，含路径别名与类型引用反例。
- 构建：`pnpm build:vscode` 与 `pnpm --filter codem build:native-chat` 通过；构建不启动 VS Code 或 Core。`git diff --check` 通过。
- 模拟界面：复用既有 4318 服务（PID 60961），只创建一个内置浏览器标签页；实际检查浅色命令菜单、键盘选择、Shell 确认取消后的草稿、展开的主题选择器、深色资源面板及历史列表。控制台无错误/警告，任务结束关闭本任务标签页，保留既有预览服务。
- 真实 Core：未运行；调用链和协议实现未变化。真实 VS Code：未运行；未把两种扩展构建和模拟操作当作真实宿主验收。
- 旧路径搜索：生产实现及构建配置已迁移；旧平铺路径仅保留于 `sourceLayout.test.ts` 的负向测试。公共包与 `history/` 未修改。

插件管理新增边界及验证见 [pluginManagementAcceptance.md](pluginManagementAcceptance.md)：Node 管理命令位于 `packages/app-server/src/plugins/`，Host 生命周期位于 `src/plugins/`，共享 UI 仅消费安全显示契约。目录门禁包含该目录正例和入口平铺反例。

## Webview 只挂载共享 UI（2026-09-25）

问题：生产 `webview/main.ts` 已只挂载 `@codem/ui`，但 `webview/` 仍保留旧输入区、消息、状态、账户、面板、资源、历史与 shadcn 组件副本，`src/shared/` 还留有只被它们使用的展示规则；样式入口是共享样式的分叉副本，插件管理等共享样式和共享组件用到的 Tailwind 工具类到不了 `dist/webview.css`，与 JetBrains 已经不一致。

边界与归属：界面、组件和样式只在 `@codem/ui`；VS Code 保留入口、Host 桥和主题桥接。桥接只做两件 VS Code 独有的事：让 VS Code 注入的 `--vscode-*` 主题色不被共享 `.codem-light` 兜底色遮住；把高对比主题映射到 VS Code 注入的高对比色。共享界面仍在渲染、原先只在 VS Code 副本里的样式（消息操作、产物卡片、图片预览、历史加载、轮次状态、Dialog 默认值）移入共享样式，JetBrains 同步获得；无对应 DOM 的旧规则删除。没有新增状态、缓存、RPC、子进程或生产依赖；首屏、重载与上下文切换仍由共享界面和 Host 桥原有逻辑负责。

仍在生效的规则测试随实现迁入 `packages/ui/tests/`（时间线分组、轮次变更、欢迎与工作状态、斜杠命令可用性、耗时格式）；历史重载耗时和真实回复分组保留 Host 侧，改用共享 UI 投影与规则。只覆盖已删除 `ComposerState` 回执模型的测试随实现删除，现行回执规则由 `draftRetention` 测试覆盖。

门禁：`sourceLayout.test.ts` 只允许 `webview/` 下的 `main.ts`、`styles.css` 与 `host/`，并对重建 `components/`、`composer/`、`styles/` 给出反例；`webviewStyles.test.ts` 编译真实入口，校验共享样式原样包含且额外规则只限 `body.vscode-*`，反例覆盖未限定规则、分叉/缺失副本和桥接外的 at-rule；`productionReachability.test.ts` 拒绝 `src/` 与 `webview/` 下任何正式入口到不了的 TypeScript 文件（运行时与仅类型引用都算可达，测试引用不算），入口清单由构建脚本共用。

## 扩展入口只做激活、组装与释放（2026-09-25）

问题：`src/extension.ts`（258 行）除组装外还承担功能逻辑并持有可变状态。`dispatch` 是 73 个 case 标签的 `switch`，内含登录准入与拒绝回执、线程标识校验、本地插件文件夹校验、文件搜索/选择失败映射、发送失败提示和退出登录清理顺序；`publish` 回调在断线时撤回 Host 面板并计算相位耗时；命令表内有登录/账户页导航判断；另有会话打开（运行时、MCP、分段耗时、失败关闭 Host）、回合事件日志和加入上下文。可变状态为 7 个闭包变量（`surfaces`、`selection`、`review`、`nextEdit`、`connectingAt`、`previousPhase`、`autoConnectAttempted`）和 2 个模块变量（`controller`、`accountController`）。构造顺序成环：界面容器构造时需要 `dispatch`，而 `dispatch`、账户、选区与聊天发布又都要调用界面容器，于是 `surfaces` 迟后赋值并到处 `?.`，`selection!` 10 处、`surfaces!` 与 `review!` 各 1 处非空断言。`integrations/gitActions.ts` 拿到整个 `ChatController`，只用其中 3 个方法。

目标边界：入口只创建对象、按依赖顺序连接窄能力、注册释放；任何判断都属于某个功能所有者。

| 职责 | 所有者 | 只接收 |
| --- | --- | --- |
| Webview 动作到功能调用的映射：未登录准入与拒绝回执、线程标识校验、文件搜索/选择与图片回执、发送失败提示、退出登录清理顺序 | `chat/viewActionRouter.ts` | 所调方法的 `Pick`（聊天、账户、选区、面板、界面容器、原生能力、会话打开）与日志、提示、输出面板三个函数；不引用 `vscode` 运行时 |
| 本地插件文件夹 → 安装来源（取消、非本地文件夹拒绝） | `plugins/pluginSource.ts` | 选择结果；文件夹对话框由 `integrations/nativeFeatures.ts` 提供 |
| 自动连接的唯一一次尝试及其触发（ready、授予信任、改设置） | `connection/autoConnect.ts` | 是否登录、界面是否可用、连接 |
| 会话打开：运行时 → MCP、分段耗时、失败关闭；上次连接的读取与记住；回合事件日志 | `connection/sessionOpener.ts` | 偏好、MCP 读取、认证状态回调、日志 |
| 相位耗时与失败日志 | `chat/chatLog.ts` | 写一行日志 |
| 断线撤回面板 | `panels/panelBroker.ts` 的 `followChat` | 聊天相位 |
| 聊天命令（打开、历史、新会话、连接、账户、登录） | `chat/chatCommands.ts` | 所调方法的 `Pick` |
| 加入上下文（信任、选区匹配、工作区校验、消费选区） | `integrations/editorSelection.ts` 的 `addContext` | 追加草稿与校验路径两个函数 |
| 登录准入 | `connection/accountController.ts` 的 `assertSignedIn` | — |
| 发送键设置的读、写与变更监听 | `chat/chatSurfaces.ts` | — |
| 提交说明生成可调用的聊天方法 | `integrations/gitActions.ts` | `Pick<ChatController, "contextKey" \| "assertContextDirectory" \| "generateText">` |

构造顺序：界面容器先创建，只注册发送键设置监听，账户、选区、聊天交互直接拿到它；路由创建后调用 `surfaces.serve(handlers)` 才注册侧栏视图与编辑器恢复，所以任何界面挂载时处理器已经存在，`serve` 只能调用一次。聊天快照经入口持有的 `vscode.EventEmitter` 发布：编辑器建议功能要调用聊天，只能在聊天之后创建，因此只有这一条边迟后订阅；监听器按原 `publish` 的顺序调用面板、日志、选区、编辑器审阅、Next Edit、界面容器。

| 状态 | 所有者 | 保存范围 | 清理时机 |
| --- | --- | --- | --- |
| 自动连接已尝试 | `AutoConnect` | 一次激活 | 退出登录时重置；失败不重置；随订阅释放注销监听 |
| 上一个相位、本次连接开始时刻 | `ChatLog` | 一次激活 | 随激活结束 |
| 界面处理器 | `ChatSurfaces` | 一次激活 | 只写一次；释放时注销视图与序列化注册 |
| 当前激活的异步释放 | 入口模块的 `deactivations` 集合（唯一模块状态） | 激活到 `deactivate` | `deactivate` 取出、清空并等待 |

必须保持的交互（每个 Webview 动作行为不变）：未登录只接受 ready、登录、退出、取消登录、刷新账户和查看日志，其余动作不触达功能，粘贴图片与发送得到拒绝回执并重新发布账户；控制类线程动作（steer、旁路提问、Shell、压缩、回退、清空）只作用于当前线程，`manageThread` 照旧不校验；文件搜索失败回空列表与“文件搜索失败，请重试。”，选中文件失败回 `accepted: false`；附带选区发送失败提示原因并回 `accepted: false`；退出登录依次撤回面板、清空选区、重置草稿、允许下个账户再自动连接一次，再重置聊天并记录 `Account disconnect`；插件文件夹取消返回无来源，非本地文件夹以“插件需要可访问的本地文件夹。”拒绝，对话框关闭后已取消的操作不再继续；自动连接每次激活最多一次，未打开聊天、未信任、无文件夹或关闭设置时不连接；命令与账户页导航不变。关闭时 `deactivate` 等待 `ChatController` 与 `AccountController` 释放，订阅释放仍撤回面板；`pnpm test:shutdown` 的关闭预算不变。

调用链：不新增认证、RPC、子进程或缓存；会话打开仍是一次 connectRuntime → 一次 SecretStorage MCP 读取，失败关闭 Host；ready 仍是一次账户读取加最多一次连接。
