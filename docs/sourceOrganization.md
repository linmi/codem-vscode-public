# VS Code 应用目录组织

## 首次目录迁移：边界与不变量

现状：Host 功能文件平铺在 `src/`，Webview 状态与视图平铺在 `webview/`，业务组件和 shadcn 基础组件混在 `components/`。本轮按现有职责迁移 VS Code 应用内部路径，不修改业务规则、消息协议、状态所有权、保存范围或清理时机，不移动公共包或历史快照。

首次启动、重复操作、取消、失败重试、重载和工作区/空间/会话切换继续执行原有实现；输入区行为和所有权见 `qualityGates.md`。没有新增认证、网络、RPC、子进程或缓存。验证重点是路径解析、两种扩展构建、Webview 样式扫描、实际展开的菜单以及既有生命周期测试。

JetBrains 应用在 `apps/jetbrains/`：`core`/`account`/`session`/`history` 是无 IDE 依赖的领域层，`ide`/`webview` 提供端口，`src/plugin/kotlin` 才引用 IntelliJ/JCEF。测试在应用根 `tests/`。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `apps/vscode/src/extension.ts` | 正式扩展入口：只做激活、组装与释放 |
| `src/chat/` | 聊天协调器、界面容器、Webview 动作路由、聊天命令、聊天日志、HTML 与 Host 展示投影 |
| `src/connection/` | 独立账户认证与展示状态、连接、会话打开、自动连接、空间目录、连接偏好和 MCP 配置 |
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
| 会话打开：运行时 → MCP、分段耗时、失败关闭；上次连接的读取与记住；回合事件日志 | `connection/sessionOpener.ts` | 本次激活的运行时校验器（与账户读取共用）、偏好、MCP 读取、认证状态回调、日志 |
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

### 实施步骤

1. `gitActions.ts` 改收 `Pick<ChatController, "contextKey" | "assertContextDirectory" | "generateText">`，与行内补全相同。
2. 状态与构造顺序：界面容器先建、`serve` 后挂载；`AutoConnect`、`ChatLog`、`PanelBroker.followChat` 接管自动连接、相位耗时和断线撤回；聊天快照经 `EventEmitter` 发布；`deactivate` 等待模块内唯一的 `deactivations` 集合。此步 `dispatch` 仍在入口，只改读常量。
3. 路由：`dispatch` 整体移入 `ViewActionRouter`，插件文件夹规则移入 `plugins/pluginSource.ts`，文件夹对话框移入 `NativeFeatures.pickPluginFolder`，发送键写入移入 `ChatSurfaces.saveSendKey`；`action satisfies never` 让未路由的新动作编译失败。发送分支里第二次登录判断删除：准入已对未登录账户返回，中间没有 await，这个分支不会执行。
4. 其余逻辑：`SessionOpener`、`registerChatCommands`、`EditorSelection.addContext`、`AccountController.assertSignedIn`。扩展版本号改为激活时读取一次（原为每次连接时读取，值不变）。变基时并入 main 上的运行时校验器改动：入口创建一个 `createBundledAppServerRuntimeResolver`，账户读取与 `SessionOpener` 共用。
5. 门禁：见 [qualityGates.md](qualityGates.md#扩展入口门禁)。

入口结果（与当前 main 比较）：265 行 → 106 行；`case` 69 行（73 个标签）→ 0；可变闭包变量 7 个与模块变量 2 个 → 0，仅保留有注释的 `deactivations` 集合；非空断言 14 处（含插件分支 2 处）→ 0；Oxlint 圈复杂度检查在旧入口报 27 处，新入口 0 处。行数只作结果记录，不是验收依据。

### 准出记录

- 功能修改集中：每条判断都在一个所有者里（上表），入口只剩构造、接线闭包与释放，由复杂度门禁保证入口没有判断。
- 状态可独立验证：`AutoConnect`（`autoConnect.test.ts` 经真实入口）、`ChatLog`（`chatLog.test.ts`）、`ChatSurfaces.serve`（`chatSurfaces.test.ts`：未 `serve` 不注册、只能 `serve` 一次、发送键变更重发）、`PanelBroker.followChat`、`SessionOpener`、`EditorSelection.addContext`、`AccountController.assertSignedIn` 各有测试；路由 7 项测试覆盖未登录拒绝回执、过期线程标识、文件搜索/选择失败回执、插件文件夹与市场标识、发送失败提示、退出登录顺序与计时、空间/发送键/日志的交接。
- 变异验证：去掉 steer 的线程校验、把文件搜索失败的提示改为 null、去掉插件文件夹的 scheme 校验、去掉对话框关闭后的取消检查，对应路由测试均失败；删掉一个路由分支，类型检查失败。
- 取消、失败、重载、上下文切换：退出登录失败仍记录耗时并把失败交给账户所有者（显示 signOutFailed）；插件选择取消与迟到结果、会话打开时 MCP 失败关闭 Host、取消后不上报认证状态、损坏的上次连接在启动 Core 前失败，均有测试；Webview 重载沿用 `ChatSurfaces` 既有恢复与 `publish` 重放；自动连接重载不重复，退出后允许下个账户一次。
- 依赖方向：入口 → 功能单向；`productionReachability` 仍要求每个新文件可从正式入口到达；架构门禁拒绝任何生产模块引用入口。路由、命令与会话打开只引用所需类型，路由不引用 `vscode` 运行时。没有新增循环：唯一迟后的边是聊天快照的 `EventEmitter` 订阅和界面容器的 `serve`，两者都是显式 API。
- 已知差异：聊天快照监听改经 `vscode.EventEmitter` 派发，监听器抛错时由 VS Code 记录而不再抛回控制器；正常路径的调用顺序与次数不变，现有监听器不会抛错。

### 验证层次

- 单元/集成：变基到当前 main 后 `pnpm check` 通过（VS Code 应用 498 项，含 JetBrains 域检查；总数含同期其他任务的测试）；`pnpm test:architecture` 77 项、`pnpm test:shutdown` 7 项通过；五个提交逐个运行 lint、类型检查和 VS Code 测试均通过。`runtimeIntegrity.test.ts`（main 新增）的夹具随入口调整为让新所有者真实运行，只替换 Core 连接。
- 构建：`pnpm build:vscode`、`pnpm --filter codem build:native-chat` 通过；`git diff --check` 通过。
- 模拟界面：在本任务自己的 4338 端口与单独新建的标签页运行 Webview 预览（变基后构建）。实际展开思考强度、权限、模型菜单与能力目录类型选择；强度改为 high、权限改为自动审批后触发器随模拟 Host 回写更新；`@` 文件搜索返回 `src/main.ts`，回车选中后成为附件且焦点回到输入框，无结果时不显示列表；历史打开、刷新提示、关闭；能力目录由插件切到技能并刷新出 2 项；Escape 后焦点回到触发器；控制台无消息。模拟 Host 在页面内（`previewRuntime.ts`），不经过 `ViewActionRouter`、`ChatSurfaces` 或入口，因此这一层只证明 Webview 侧与消息形状未受影响；模拟 Host 没有实现插件管理与恢复历史，这两项未在界面层验证，由路由与控制器测试覆盖。结束后关闭本任务标签页并停止该服务，未触碰其他任务的标签页与服务。
- 真实 VS Code：没有可复用的开发宿主，运行一次默认 `pnpm --filter codem test:extension`（临时隔离的用户目录，工作区关闭自动连接，不启动 Core）：激活、16 个命令注册、打开聊天、重复“在标签页打开”只开一个、移回侧栏、原生能力检查通过，扩展宿主退出码 0，结束后无残留进程。未做手动交互或实时模型验证。
- 真实 Core：未运行。

## 多会话并行（2026-09-26）

问题：App Server 按 threadId 管理线程，同一连接可同时跑多个会话；但 `ChatController` 只持有一个 threadId，新建或切换会话前先退订当前线程，App Server 退订时中断正在运行的回合，所以运行中既不能切换，也不能让两个会话同时运行。

目标边界：界面始终只投影一个前台会话；切走时仍在运行的回合交给 `chat/parkedConversations.ts`，由 Core 继续执行、App Server 保持订阅。这里不投影消息，Core JSONL 仍是唯一持久历史来源。

| 状态 | 所有者 | 保存范围 | 清理时机 |
| --- | --- | --- | --- |
| 后台线程：标题、订阅时的设置、turnId、未答复的审批/问答请求、运行状态 | `ParkedConversations` | 一个连接 | 回合结束即退订，条目保留为“已结束”直到被查看（最多 10 条）；被切回时移交前台；Core 关闭线程时删除；断线、切换账户或释放时清空 |
| 前台回合未答复的请求 | `ChatController` 的 `ActiveTurn.pending` | 一个回合 | 答复成功或收到 `interaction-resolved` 时删除；回合转入后台时随之移交 |
| 恢复中的线程 | `ParkedConversations` 的 claim 标记 | 一次恢复 | 恢复成功时移交；失败时解除，期间结束的回合在此时退订 |

必须保持的交互：
- 只在 `running` 且没有压缩/回退、补充指令或后台进程操作时可以切走；发送中、停止中、旁路提问时不可切换。新建会话与历史切换使用同一条件，界面由 `sessionSwitchable` 判断。
- 切走时撤回当前审批面板，但不答复 Core；切回运行中的会话时，先按其订阅设置恢复记录，再接上实时事件，并重新询问尚未答复的请求。
- 恢复运行中会话失败时不退订它，它继续在后台运行；恢复期间回合结束时，显示后再读一次记录，补上最后的内容。
- 仍有后台回合运行时拒绝切换空间，因为关闭连接会中断这些回合。
- 底部卡片列出后台会话及状态（运行中、等待审批、已完成、已停止、失败），点一行即切换；没有后台会话时不渲染。

调用链：切走不新增 RPC（不退订）；后台回合结束多一次 `thread/unsubscribe`，与原来切走时的退订相同。切回运行中的会话时 `thread/resume` 在 App Server 内命中已订阅线程直接返回，其余与恢复历史相同：`thread/read`、`readModes`、一次 JSONL 读取；只有恢复期间回合结束时才多读一次 JSONL。

准出记录：
- 功能修改集中：后台线程的状态与退订只在 `ParkedConversations`；`ChatController` 只在切走（`park`）、切回（`restoreConversation` 的 claim/take）和事件入口三处接入，恢复事务仍由 `ConversationHistory` 负责，新增的 `detached` 与延迟求值的 `previous` 决定失败时是否退订。
- 状态可独立验证：`historyController.test.ts` 覆盖切走不退订、两个会话同时运行、切回后重新询问审批、后台结束即退订、新建会话转入后台、后台运行时拒绝切换空间、切回失败保持后台运行、恢复期间回合结束后补读记录、恢复期间前台回合结束不抢相位。变异验证：切走时照常退订、失败恢复时退订目标，对应用例失败。
- 取消、失败、重载、上下文切换：断线、切换账户与释放清空后台列表，App Server 关闭时中断这些回合；重载窗口后只恢复前台会话书签，后台回合随 Core 进程结束，与原先前台回合相同。
- 依赖方向：`parkedConversations.ts` 只引用 `@codem/app-server` 类型与共享的 `historyTypes.ts`，不引用 Controller；无循环依赖。
