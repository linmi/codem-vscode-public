# App Server 能力对照审计

审计日期：2026-09-20。代码基线：`d1bc7482d118a1f5b6ad4cab89aecf95c829745c`。运行时：CLI **0.1.208** / Core **0.8.37**。

结论：Core 已提供主要 Agent 执行、会话管理、审批和目录查询能力，Node Host 也已封装其中大部分。主要缺口在 VS Code 的操作入口与事件呈现。应先对照 Core 协议补接入；认证、空间及协议外的管理功能再按具体需求查 CLI。

这是固定版本的能力盘点，不是功能实施计划或新增功能验收报告。审计期间工作区出现了独立的能力接入改动，因此以下「已接入 / 未接入」统一以该提交为准，不把未提交代码或另一份接入设计计入交付。链接指向对应源码路径；复核基线内容可用 `git show d1bc748:<路径>`。

## 证据等级与职责

- **实测声明**：真实运行安装的 `codem-core app-server`，仅请求 `initialize`；确认版本、协议和能力位。能力位为 true 不等于本轮实际执行过该功能。
- **Host 已封装**：基线生产代码有方法、类型或事件转换。通用 `connection.request()` 能发送任意方法，不算有对应的领域封装。
- **VS Code 已接入**：从生产操作入口到控制器、Host，或从 Host 事件到显示状态存在调用链。它不等于已完成真实按钮操作验收。
- **待核实**：只有能力位或本地调用方证据，尚未核实完整输入、返回、错误或生命周期契约；不推断未声明的功能。

职责分配：

| 层 | 当前职责 | 证据 |
| --- | --- | --- |
| Core App Server | Agent 执行、thread/turn 身份、工具与审批事件、Core 历史写入 | [运行连接][connection]、[Host][host] |
| `@codem/app-server` | Node 客户端；二进制版本与完整性、stdio RPC、DTO 校验、连接和订阅生命周期、CLI broker 适配 | [运行时][runtime]、[Host][host]、[认证][auth]、[空间][spaces] |
| `@codem/history` | 只读 Core JSONL schema 13 的历史投影、分页和完整性检查 | [历史包说明][historyPackage] |
| VS Code | 工作区信任、原生文件与凭据保护、设置保存、白名单界面消息、用户交互 | [扩展入口][extension]、[控制器][controller]、[消息边界][messages] |

## 会话、对话与执行

能力位列的值均来自本次真实握手；没有独立能力位的 RPC 明确列为本地契约证据。

| 能力 / Core 依据 | Host 封装 | VS Code 基线状态与缺口 |
| --- | --- | --- |
| 建立 / 恢复会话：本地契约 `thread/start`、`thread/resume` | `startThread`、`resumeThread` | 已接入。首次发送创建；历史恢复和设置应用复用原 threadId |
| 列表 / 读取：`threads.list/read=true` | `listThreads`、`readThread` | 已接入历史列表、分页、工作区校验与恢复 |
| 改名：`threads.setName=true` | `control(..., "thread/name/set", ...)` | 未接入；没有改名操作入口 |
| 分叉：`threads.fork=true` | `control(..., "thread/fork", ...)` | 未接入；分叉后的身份、显示与恢复流程尚未实现 |
| 归档 / 解除归档：`threads.archive=true`；解除归档另有本地 `thread/unarchive` 契约 | `control` 的 archive / unarchive 分支 | 未接入操作；列表能表示 archived 状态不等于支持归档管理 |
| 删除：`threads.delete=true` | `control(..., "thread/delete", ...)` | 未接入；删除范围、确认和结果不明后的处理尚无界面链路 |
| 清空：`threads.clear=true` | `clearThread` | 未接入。「新建会话」是取消旧订阅并重置当前视图，不调用清空 |
| 压缩：`threads.compact=true` | `compactThread` → `thread/compact/start` | 未接入主动入口；能显示 contextCompaction 活动不等于能主动压缩 |
| 回退：`threads.rewind=true` | `rewindThread` → `thread/rewind/start` | 未接入主动入口；选择回调另有缺口，见审批表 |
| 发起轮次：本地契约 `turn/start`；`items.streaming=true` | `startTurn`、流式事件 | 已接入发送回执、失败保留草稿、流式显示和终态关联 |
| 中断：`turns.interrupt=true` | `interruptTurn` | 已接入停止；回执不代表结束，等待 `turn/completed` |
| 执行中追加指令：`turns.steer=true` | `steerTurn`，带 `expectedTurnId` 和 submissionId；当前只发纯文本 | 未接入。`send()` 仅允许 ready 阶段，不会自动走 steer |
| 旁路提问及取消：`threads.sideQuestion/sideQuestionCancel=true` | `startSideQuestion`、`cancelSideQuestion`、独立事件 | 未接入。现有 Host 禁止与主轮次并发；不能直接设计成运行中随时旁问 |
| 附件：`turns.attachments=true` | `AppServerPromptAttachment`；图片走 localImage，文件 / 目录走 CodeM 扩展字段 | 基线客户端以 supportsVision 拦截图片；后续实测证实 Core 可通过图片工具处理，原判断过严，修正见 [图片验收记录](interactionAcceptance.md) |
| 显式 Skill 输入：`turns.skillInput=true` | **未封装**；基线 `startTurn` 输入只有 text / attachments，序列化没有 skill 分支 | 未接入。必须核实该版本结构化输入格式，不能以普通文本或 slash 文本冒充 |
| 模型选择：`threads.modelSelection=true` | settings.model / intelligence；start / resume | 已接入模型与强度；范围来自 Core 模型目录及共享类型 |
| 初始计划 / 会话模式：`threads.initialPlanMode/sessionModes=true` | 新会话 executionMode；`readModes`、`setModes` | 已接入 Agent / Plan、权限模式及 revision 冲突处理；运行中锁定设置 |
| 手动 Shell：`threads.shellCommand=true` | `runShellCommand` | 未接入用户命令入口。Agent 能执行命令、界面能显示输出，与此不同 |
| 后台终端：`threads.backgroundTerminals=true` | `listBackgroundTerminals`、`terminateBackgroundTerminal`、`cleanBackgroundTerminals` | 已接入刷新、日志快照、终止与清理；日志读取是 VS Code 本地能力 |
| 后台任务取消：`threads.backgroundTaskCancel=true` | `cancelBackgroundTask`、background-wake 事件 | 已接入任务状态与取消；taskId 与进程 PID 分开处理 |
| 活跃线程目录：本地契约 `thread/loaded/list` | `listLoadedThreadIds` | 未接入；不是历史线程目录的替代品 |
| 实时轮次 / Item 快照：`threads.turnsList/itemsList=true` | `listLiveThreadTurns`、`listLiveThreadItems` | 未接入；按项目边界不可替代 JSONL 持久历史 |
| 额外目录：本地 thread 参数 `additionalDirectories` | `AppServerThreadSettings`、start / resume 序列化 | 无独立设置入口；附加一个目录作为消息附件不等于配置额外工作目录 |
| 取消订阅 / 释放：本地契约 `thread/unsubscribe` | `unsubscribeThread`、`close` | 已用于新会话、切换与退出；含有界的子进程回收 |

主要证据：[Host 方法与输入序列化][host]、[控制器][controller]、[扩展操作分发][extension]、[历史列表][historyList]。方法存在性还与 [Host fixture 测试][hostTests] 交叉核对；fixture 不构成真实 Core 功能执行证明。

## 审批与输出事件

| 能力 / 协议依据 | Host 状态 | VS Code 基线状态与缺口 |
| --- | --- | --- |
| 命令 / 文件 / 权限审批：`clientRequests.commandExecutionApproval/fileChangeApproval/permissionsApproval=true` | 转为 permission 交互并校验选项、请求归属 | 已接入审批卡片、取消和过期结果拒绝 |
| 用户问答：`clientRequests.userInput=true` | question 请求及响应 | 已接入多题、返回上一题、自由文字和取消 |
| 计划审批：`clientRequests.planApproval=true` | plan 与 plan-mode 交互 | 已接入同意 / 拒绝；计划拒绝可反馈文字 |
| 回退选择：`clientRequests.rewindSelection=true` | rewind 检查点、模式与响应类型已封装 | **未完成**：`showInteraction()` 收到 rewind 时直接返回 `{ cancelled: true }`，没有选择界面 |
| 消息 / 思考 / 工具流：`items.streaming=true`，types 见下文 | Item 解析、输出增量、callId 关联、终态事件 | 已接入回复、折叠活动、工具详情、产物卡片；子代理作为活动展示，不是独立子代理管理界面 |
| 文件补丁：本地 `item/fileChange/delta` 契约 | `file-diff` | 已接入文件统计、补丁预览及安全打开文件 |
| 整轮 diff 汇总：本地 `turn/diff/updated` 契约 | `diff-updated` | 未消费该汇总事件；已有资源面板来自上面的 file-diff 链路 |
| 计划进度：本地 `turn/plan/updated` 契约 | `plan-updated` | 未消费；计划审批卡片不等于计划进度展示 |
| Token 用量：本地 `thread/tokenUsage/updated` 契约 | `usage-updated` | 未消费；不能从该事件推断已有费用统计 |
| 工具输出保护：本地 `item/toolCall/guardUpdated` 契约 | `tool-guard` | 未消费保护状态、返回字节数或截断信息 |
| Hook 结果：本地 `hook/completed` 契约 | `hook-completed` | 未消费；Hook 成败不等于轮次终态 |
| 后台唤醒 / Core 主动轮次：本地 wake、turn 事件契约 | background-wake；submissionId 为 null 的 turn-started | 已接入后台任务状态及后续轮次的正常流式 / 审批 / 完成链路 |
| 模式广播 / 认证失效 / 连接失败 | 对应 Host 事件 | 已消费；模式同步或撤销旧连接事件权限 |
| 运行警告、线程状态 / 关闭 / 清空、目录变更 | warning、thread-status-changed、thread-closed、thread-cleared、control-changed | 未形成对应界面处理；不能用 Host 已识别通知来证明 UI 已处理 |

真实握手的 `items.types` 为：userMessage、agentMessage、reasoning、commandExecution、fileChange、mcpToolCall、webSearch、contextCompaction、toolCall、subagent。`items.statuses` 为：inProgress、completed、failed、declined、interrupted。这是事件分类声明，不保证每个模型、每种配置均能触发所有工具。

证据：[通知白名单][controlPlane]、[Host 通知转换][host]、[控制器 onEvent][controller]、[审批映射][interactions]、[工具详情投影][toolDetails]。

## 目录、配置与 MCP

| 能力 / 实测能力位 | Host 封装 | VS Code 基线状态与缺口 |
| --- | --- | --- |
| 模型：`controlPlane.models=true` | `listModels` → model/list | 已接入连接预检与选择器 |
| Skills：`controlPlane.skills=true` | `listSkills` → skills/list | 无目录或选择入口；与显式 skillInput 的 Host 缺口是两层问题 |
| 插件：`controlPlane.plugins=true` | `listPlugins` → plugin/list | 未接入列表；现有证据不证明支持安装、更新或卸载 RPC |
| Hooks：`controlPlane.hooks=true` | `listHooks` → hooks/list | 未接入目录；现有证据不证明支持编辑 RPC |
| 配置读取：`controlPlane.configRead=true` | `readConfigSnapshot` → config/read，含敏感键处理 | 未接入配置诊断；原始配置不可直接透传 Webview |
| 配置写入：`controlPlane.configWrite=false` | 无写入封装 | 该 App Server 版本明确未声明支持；不能以通用 request 绕成已支持 |
| 环境：`controlPlane.environment=true` | `readEnvironmentInfo` → environment/info | 未接入诊断界面 |
| 权限配置目录：`controlPlane.permissionProfiles=true` | `listPermissionProfiles` | 未调用目录接口；已有权限切换使用共享模式类型及 mode read/set |
| 空间：`controlPlane.spaces=true` | `readCoreSpaceSnapshot` → space/list | 未消费 Core 快照；空间选择实际使用 CLI broker，见下表 |
| Provider 扩展能力：本地 modelProvider/capabilities/read 契约 | `readModelProviderCapabilities` | 未接入；模型目录的 supportsVision 检查是另一条链路 |
| 工具目录：`controlPlane.tools=true` | `listTools` → tools/list | 已接入基础工具列表和刷新；不代表 MCP 服务器健康检查 |
| MCP stdio：`mcp.stdio=true` | `AppServerMcpServer`；thread start/resume 参数 | 已接入添加 / 启用 / 停用 / 移除，配置存 SecretStorage；工具由模型按需发现 |
| MCP HTTP：`mcp.http=false` | 类型仅允许 stdio | 该版本明确未声明支持，不应添加仅能保存但不能运行的 HTTP 入口 |

证据：[控制面 DTO][controlPlane]、[Host][host]、[连接预检与目录加载][session]、[原生功能与 SecretStorage][native]、[设置面板][settings]。

## CLI 与本地历史边界

| 功能 | 当前真实链路 | VS Code 基线状态 |
| --- | --- | --- |
| 登录状态与浏览器登录 | CLI `auth status --json`、`auth login --json --force`；认证适配返回状态与授权 URL | 已接入；不自行读写凭据文件 |
| 退出登录 | `signOutAppServer` → CLI `auth logout`，随后读取状态 | 包已封装，VS Code 无退出登录入口 |
| 空间目录 / 启动材料 | CLI `__host-serve` 上的 project_list / space_prepare；`prepareInitialAppServerSpace` 等 | 已接入首次连接、目录刷新和切换；选定 projectKey / managed directory 由 Host 注入 Core |
| 修改 CLI 全局空间 | `commitAppServerSpace` → space_commit | 未调用是当前产品边界；VS Code 只切换本连接空间，不应为了「接满接口」顺带改写全局选择 |
| Core 运行时凭据 broker | `appServerHostEnvironment` 设置 bundled CLI 的 `__host-serve` 命令 | Core 直接运行，CLI 提供凭据控制通道；不构成第二套 Agent 传输 |
| 持久历史消息 | `@codem/history` 只读 Core JSONL schema 13 | 已接入恢复与分页；实时 RPC 快照不能成为第二个历史来源 |
| 文件打开 / 日志快照 / 附件预览 / @ 文件名查找 | VS Code 与本地文件系统适配 | 属于应用能力，不是 Core 声明的编辑器界面功能 |

证据：[认证][auth]、[空间 broker][spaces]、[运行时连接][session]、[历史包][historyPackage]、[原生功能][native]。认证、目录刷新和连接的调用次数已有专门的 [连接治理记录][governance]，本次不重复登录或查询用户账户。

## 哪些地方需要查 Core / CLI 源码

1. **显式 Skill 输入**：已实测 skillInput=true，但当前 Host 未表达该输入。查 Core 0.8.37 对应协议类型、turn/start 分发与解析，核实标识方式、附件组合和错误返回；必要时参考同版本 CLI 调用方。能力位不能证明支持某种标准 skill-path 格式。
2. **旁路提问和回退**：先查 Core 的并发约束、历史影响、取消终态和检查点语义。当前 Host 的串行限制是现状，尚不能判定为必须保留的产品语义，也不能在缺少证据时移除。
3. **插件 / Hook / 配置管理**：目前有读取接口；只有产品明确需要管理操作时，才查 CLI 对应命令和数据所有权。App Server configWrite=false 不表示 CLI 也无配置能力，反之 CLI 有命令也不表示 App Server 存在同名 RPC。
4. **其余已封装接口**：优先补齐应用调用链；出现字段、状态或错误契约不明，再按该版本查 Core 源码和正式文档，不整包搬入 CLI 框架。

本次未审计 CLI / Core 的完整源码或导出完整 RPC schema。因此本表覆盖实测握手能力和当前 Host 契约，不宣称枚举了 Core 所有隐藏接口或 CLI 所有功能。

## 两个可独立交付的后续 Cycle

以下是基于基线证据的候选，不是本次实施内容；若并行开发已覆盖，应先对照其完成结果，避免重复开发。

| Cycle | 证据与优先级依据 | 变更边界 / 可观察结果 | 准出标准 |
| --- | --- | --- | --- |
| P1：执行中追加指令 | steer=true 且 Host 已封装，当前 send 只接受 ready；直接补齐运行中纠正任务的操作 | 输入与回执、白名单消息、控制器；保留 expectedTurnId / submissionId，用户可在同一轮次追加纯文本 | 首次与重复提交、取消、失败保留草稿、回执与终态竞态、切换上下文后迟到结果均有验证；真实 Core 确认未新建轮次；真实 VS Code 验证运行中提交及停止行为 |
| P2：只读 Skills 目录 | skills=true 且 listSkills 已封装但无界面；先让用户确认当前实际可用技能，避免猜测安装状态 | 只读目录、加载 / 刷新、上下文失效；不含安装、编辑或显式 Skill 发送 | 展开后的目录、空列表、失败重试、取消与重复加载可判定；连接 / 空间切换丢弃旧结果；敏感路径不出 Host；分别记录 fixture、真实 Core、真实 VS Code 验证 |

## 本次验证与限制

- 真实 Core：再次运行安装二进制的单次 initialize，退出码 0，协议版本 1，返回 `agentVersion=0.8.37+2613.g235cb2e.dirty`；通过仓库 `validateAppServerInitializeResult` 校验。构建字符串如实保留，不据此猜测上游源码修订内容。
- 握手额外观察：skillInput、clear、sideQuestion、sideQuestionCancel 为 true；现有 preflight 必需能力清单没有逐一要求这些位。初始化校验通过不等于 Host 封装覆盖完整能力集。
- 静态审计：检查基线全部 `apps/vscode/src` 生产调用方、Host 方法 / 参数 / 事件、消息白名单与扩展分发，区分「目录展示」「操作入口」「被动事件展示」。不是只搜索方法名称后判定功能完成。
- 文档验证：核对本文件相对链接在固定基线中存在，检查 diff 与空白错误；本次只新增本文件，不改功能实现。
- 单元 / 集成测试：阅读现有 fixture 和回归测试作为映射证据；本次文档变更未重跑测试或构建。
- 模拟界面：本次未运行。
- 真实模型任务：本次未运行，未执行会话变更、工具操作或账户写入。握手不替代逐项真实 RPC 验证。
- 真实 VS Code 操作：本次未执行。既有 [交互验收记录][acceptance] 将真实后端与 PanelBroker 模拟按钮分层报告，并保留真实按钮操作及图片模型能力的未完成事项；本次不更新其验收结论。
- 文档差异：基线 App Server README 仍有「尚无应用」和「turns/items 不再是 public host methods」的旧表述；源码已有 VS Code 应用及 `listLiveThreadTurns/Items`。本表以代码为准；这两个实时方法仍不承担持久历史读取。

[host]: ../packages/app-server/src/host.ts
[connection]: ../packages/app-server/src/connection.ts
[runtime]: ../packages/app-server/src/runtime.ts
[controlPlane]: ../packages/app-server/src/control-plane.ts
[auth]: ../packages/app-server/src/authentication.ts
[spaces]: ../packages/app-server/src/spaces.ts
[historyPackage]: ../packages/history/README.md
[hostTests]: ../packages/app-server/tests/host.test.ts
[controller]: ../apps/vscode/src/chat/chatController.ts
[extension]: ../apps/vscode/src/extension.ts
[messages]: ../apps/vscode/src/shared/messages.ts
[historyList]: ../apps/vscode/src/sessionHistory/historyList.ts
[interactions]: ../apps/vscode/src/panels/interactions.ts
[toolDetails]: ../apps/vscode/src/chat/toolDetails.ts
[session]: ../apps/vscode/src/connection/runtimeSession.ts
[native]: ../apps/vscode/src/integrations/nativeFeatures.ts
[settings]: ../packages/ui/src/chat/composerMenus.tsx
[governance]: connectionGovernance.md
[acceptance]: interactionAcceptance.md
