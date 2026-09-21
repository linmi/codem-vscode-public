# CodeM IntelliJ IDEA 插件实施方案

状态：领域骨架与契约已落地；A01–A11 / B01–B14 的真实 IDEA 准出仍受阻。更新日期：2026-09-21。

本文指导 AI 按独立 Cycle 实现、验证和交付 IDEA 插件，不是已有功能的验收报告。实施仍遵守根目录 [AGENTS.md](../AGENTS.md) 和当次用户请求；本文不授权外部发布、账户变更或真实模型消费。

## 1. 已确定的决策

1. Kotlin 宿主直接通过 stdio 连接 Core App Server，不引入 IDEA Node 后台、localhost Agent HTTP 服务或第二套 Agent 传输。
2. JCEF 承载 `@codem/ui` 静态产物。用户无需安装 Node、pnpm 或 CodeM CLI；开发与构建阶段可以使用 Node。
3. Core 与认证 CLI 仍须提供。CLI 负责凭据与空间 broker，不是第二个 Agent 后端；禁止自行读写凭据文件。
4. Core 拥有 threadId、Agent 执行、工具运行和持久历史。客户端不实现模型调度或第二份持久聊天存储。
5. 实时终态以 `turn/completed` 为准；持久历史只读 Core JSONL schema 13。实时 turns/items 快照不能替代历史。
6. 共享 UI、跨语言契约及脱敏样例；TypeScript/Kotlin 分别实现宿主，通过相同输入与预期结果约束行为。
7. 包名采用 `@codem/app-server`、`@codem/protocol`、`@codem/contracts`、`@codem/history`、`@codem/ui`。不为 IDEA 接入预建 `@codem/session`。
8. 首先支持本地 IntelliJ IDEA。远程开发、其他 JetBrains IDE、复杂 PSI 分析和行内补全不属于首版承诺。
9. 先做单平台安装包并测量，再确定公开分发方案；不能将“去掉 Node”表述为已经验证包很小。

目标用户闭环：登录 → 选择项目目录和空间 → 配置模型/权限 → 添加代码上下文 → 发送 → 审批/问答 → 查看结果与差异 → 关闭再恢复续聊。

## 2. 当前证据与实施前复核

编写时 HEAD：`ff8835640892342534db42e50d9dc1057930831e`。工作树有其他任务改动，本文不提交它们，不把未提交代码当成稳定发布基线。执行前重新记录 HEAD、工作树、运行时及目标平台。

| 事项 | 当前证据 | 执行要求 |
| --- | --- | --- |
| Core / CLI | [runtime.ts](../packages/app-server/src/runtime.ts)：0.8.45 / 0.1.208 | 以源码和锁文件为准，不默认升级 latest |
| 协议 | [preflight.ts](../packages/app-server/src/preflight.ts)：协议版本 1、版本与能力校验 | 移植校验语义；握手成功不代表各功能验收完成 |
| 传输与进程 | [connection.ts](../packages/app-server/src/connection.ts)、[rpc.ts](../packages/app-server/src/rpc.ts) | 核实帧格式、请求关联、abandon、关闭与异常语义 |
| Agent 领域能力 | [host.ts](../packages/app-server/src/host.ts)、[control-plane.ts](../packages/app-server/src/control-plane.ts)、[items.ts](../packages/app-server/src/items.ts) | 从入口、请求、事件到状态完整追踪，不只搬方法名 |
| 认证与空间 | [authentication.ts](../packages/app-server/src/authentication.ts)、[spaces.ts](../packages/app-server/src/spaces.ts)、[连接治理](connectionGovernance.md) | 核实 broker 协议，保留一次启动事务内的有效结果复用 |
| 历史 | [当前历史包](../packages/history/README.md)、[来源记录](../UPSTREAM.md) | 重放与完整性规则均需迁移，不只逐行显示 JSON |
| 会话与 UI | [chatController.ts](../apps/vscode/src/chat/chatController.ts)、[messages.ts](../apps/vscode/src/shared/messages.ts)、[Webview 入口](../apps/vscode/webview/main.ts) | 区分业务不变量与平台适配，按边界抽取 |
| 功能与验证 | [VS Code README](../apps/vscode/README.md)、[能力接入](appServerCapabilities.md)、[交互验收](interactionAcceptance.md) | 逐项核实生产链路及未完成验证 |
| 旧审计 | [固定基线审计](appServerCapabilityAudit.md) 针对 0.8.37，后续记录有 0.8.44 | 仅作线索；不把旧版本缺陷或“未接入”直接当成 0.8.45 事实 |

先检查当前代码、测试和锁定版本资料。本地证据不足或涉及外部约束时查官方文档。JetBrains 版本尚未锁定：工程建立时盘点目标用户/已有开发 IDE，再成组锁定 IDE、JDK、Kotlin、Gradle Wrapper、Platform Gradle Plugin、序列化依赖；不能直接复制最新文档的版本组合。

## 3. 架构、目录与依赖

```text
                       @codem/ui
                    /              \
          VS Code 消息桥            JCEF 消息桥
                 |                    |
         TypeScript Host         Kotlin Host
                 |                    |
        @codem/app-server       Kotlin Core client
                 |                    |
             Core stdio            Core stdio

两端分别调用认证 CLI，分别只读当前上下文的 Core JSONL。
@codem/contracts 在构建/测试阶段约束两端，不是运行中的服务。
```

以下是按需建立的职责目录，不要求先创建全部空目录：

```text
apps/
  vscode/                          VS Code 专有入口与适配
  jetbrains/
    build.gradle.kts
    settings.gradle.kts
    gradle/                        Wrapper、JVM 依赖版本
    src/main/kotlin/.../
      bootstrap/                   入口与组装
      core/                        进程、RPC、编解码、领域协议
      account/                     认证、空间、启动材料
      session/                     活跃会话、轮次、交互、切换
      history/                     JSONL、重放、分页、blob
      ide/                         项目、文件、选区、Diff、安全存储
      webview/                     JCEF、资源、消息桥、主题
    src/main/resources/            plugin.xml、图标、构建 UI
    tests/                         配置为 Gradle 测试源/资源目录
packages/
  app-server/                      @codem/app-server，Node 客户端
  protocol/                        @codem/protocol，TS 类型与纯校验
  contracts/                       @codem/contracts，规范与样例
  history/                         @codem/history，现有历史包改名
  ui/                              @codem/ui，共享聊天界面
```

遵守现有代码文件 camelCase、类型 PascalCase 规则，平台规定文件名除外。测试按仓库约定放在应用/包根 `tests/`，通过 Gradle 配置接入。

依赖门禁：

- `ui` 只依赖浏览器能力、`protocol` 及必要 UI 库；不能依赖 Node、app-server/history、VS Code 或 Kotlin 实现。
- `protocol` 无运行时依赖，不引用应用、DOM、Node；`contracts` 无生产业务逻辑，不依赖两端实现。
- Kotlin `core`、`history`、`session` 的领域实现不依赖 JCEF/Swing/IntelliJ 编辑器 API，由 bootstrap 组装平台适配。
- 应用通过公开边界消费包，禁止跨 app 内部引用；禁止引用根目录归档 `history/`。
- 活跃 `packages/history/` 与归档根 `history/` 按完整路径区分，禁止用 `**/history/**` 排除活跃代码。
- 不传入整个 Controller/万能 context；每份可变状态只有一个所有者，不建没有真实调用方的扩展框架。

## 4. contracts 包：跨语言一致性的依据

### 4.1 内容和权威来源

```text
packages/contracts/
  package.json                     private、明确 files/exports
  README.md                        消费、范围和版本规则
  manifest.json                    格式版本、Core/CLI/schema 基线
  core/                            请求/响应/通知/交互序列样例
  webview/                         UI 消息规范及正反向样例
  history/                         JSONL/blob 样例与预期投影
  tests/                           包完整性与数据结构校验
```

Core wire/schema 的权威是锁定 Core 的正式定义与运行事实；contracts 记录经验证的契约，不发明上游方法。自有 Webview 消息的字段与语义规范放在 contracts，两端实现必须符合它。可清晰表达的结构采用 JSON Schema，时序与跨字段规则用事件序列和语义断言表达，不用 schema 假装覆盖生命周期。

每条样例含唯一 ID、能力 ID、版本、来源路径/修订或脱敏实测来源、输入/事件顺序、预期结果或错误类别。未知字段、缺失、null、空字符串、错误类型和过期身份分别建模。

样例不得包含真实凭据、用户历史或绝对私有路径；测试临时根目录参数化。不得删除空白、重新排序消息或忽略错误字段来获得双端一致。

### 4.2 消费和变更

- TS 测试通过 `workspace:*` devDependency 和明确导出使用；生产 UI 不打包样例。
- Gradle 将确定的数据目录声明为输入和测试资源，不读取 pnpm 内部安装布局；用户运行时不需要 npm。
- 两端各运行自己的解析器/状态机，比较相同规范化结果。expected 由产品规则与上游证据审查，不能让 TS 现状自动定义 Kotlin 正确性。
- 正向和负向样例都运行，不能跳过 Kotlin 不支持的记录类型。contracts 改动的 CI 同时跑 TS/Kotlin 消费测试。
- 内部消息原子更新 UI 和两端宿主，不默认保留双读双写。Core 已部署协议及持久历史是外部约束，兼容必须记录版本、原因、删除条件和测试。
- 初期不建通用代码生成框架，出现稳定的结构重复后再独立证明必要性。

## 5. Kotlin Core 接入

### 5.1 启动和帧处理

规范化项目目录/信任检查/运行包校验 → 认证 → 空间准备 → Core 启动 → initialize 校验 → initialized → 必要目录与设置 → ready。

当前 Node 使用 `<core> [参数] app-server`。Kotlin 必须核实参数、环境、clientInfo、managed directory、认证 broker 命令和转义；使用参数数组，不拼接 shell。测试空格、Unicode、Windows 路径及链接。

stdout 只读协议，stderr 持续排空并有界记录。解析 UTF-8 分块、半行、多行粘连，不假设一次 read 是一帧。帧/队列/日志上限依据有效大输出样例确定，超限明确失败，不能截断协议帧后继续。

### 5.2 RPC 与事件

- 区分请求、响应、通知、服务端交互；ID 类型遵循真实协议，只有一个写入所有者，事件应用顺序确定。
- 流式文本保留空格、换行、制表符，空增量为合法 no-op。
- 未知 ID、重复响应、非法结构、已退休连接分别处理，禁止统一 catch 后继续运行。
- 本地取消/超时不表示 Core 操作已撤销；写入结果不明时核对状态，禁止自动重试。
- 普通 RPC、初始化、审批等待和生成等待分别定义超时，不用一个短超时终止所有任务。
- Node 对 response 省略 `jsonrpc` 的兼容需复核 0.8.45，限定范围；不得因此允许所有缺字段。
- `turn/activity`、Hook、工具保护、后台 wake 等范围内事件显式解析和消费，不能当未知通知导致断线。
- 不支持的服务端请求返回明确协议错误，禁止自动批准、无响应或假造成功。

### 5.3 并发与平台线程

使用项目生命周期绑定的协程作用域。I/O/解析不在 EDT；UI 更新回到平台要求线程；读取 Document/VFS/PSI 用对应 read action，写入用可撤销 write command，不持有 IDE 锁等待 RPC。[官方线程模型](https://plugins.jetbrains.com/docs/intellij/threading-model.html)

会话状态只有一个串行所有者，耗时 I/O 在锁外执行，返回时检查连接代次与上下文。禁止跨项目 GlobalScope、任意 delay 修补竞态；协程取消不能跳过有界进程回收。[项目服务生命周期](https://plugins.jetbrains.com/docs/intellij/plugin-services.html)

## 6. 状态、身份与生命周期

| 状态 | 所有者 | 保存与失效 |
| --- | --- | --- |
| threadId、历史、执行结果 | Core | 客户端只订阅、读取与操作 |
| 子进程、pending RPC、帧队列 | Core connection | 关闭拒绝 pending，重复 close 等待同一完成结果 |
| 当前目录/空间/线程/轮次、交互 | 项目会话服务 | 连接代次改变立即撤销旧事件与请求权限 |
| 空间/模型目录 | 当前连接目录对象 | 显式刷新；身份变化与连接切换失效 |
| 认证结果/启动材料 | 单次启动事务 | 用户等待后重新认证，启动材料只消费一次 |
| 草稿/偏好 | 宿主状态存储 | 按项目、cwd、空间、会话隔离，账户变化清理身份相关引用 |
| 展开/焦点 | UI 组件 | 视图销毁清理，切换上下文清理目标表单 |
| 文件/附件/Diff 句柄 | 项目资源边界 | 绑定上下文；重载重发有效引用，切换/退出撤销 |

连接阶段至少区分未连接、认证中、准备空间、启动中、就绪、失败、关闭中；轮次区分提交中、运行中、中断请求中、终态。避免独立 boolean 组合成非法状态；待审批不替代运行状态。

| 场景 | 必须保持的行为 |
| --- | --- |
| 首屏/Host 未响应 | 挂载前确定加载/禁用状态，分页/重试/恢复等条件入口默认隐藏 |
| 登录 | 无项目/未信任项目仍可账户登录，不因此启动 Core 或读项目文件 |
| 重复连接 | 合并同一次任务；失败后显式重试，不无限循环 |
| 首次发送 | 创建线程，有独立回执；失败保留草稿及附件 |
| 回执/事件乱序 | started 先于失败回执仍展示运行事实；旧回执不能清除新编辑 |
| 重复发送 | 提交阶段阻止重复，不凭相同文本推断可安全重试 |
| 停止 | interrupt 回执仅受理；合法 turn/completed 才结束 |
| UI 隐藏/重建 | 保留后台会话，ready 后重发快照，不重发用户操作 |
| 空间切换 | 运行中禁止；预检成功交接，失败/取消保留原会话 |
| 恢复历史 | 校验归属与记录，成功再替换显示；失败保留可恢复状态 |
| clear | 校验操作和旧身份，绑定新 threadId，撤销旧资源 |
| Core 主动轮次 | submissionId 为 null 也走流式/审批/终态；完成轮次不复活 |
| 崩溃/认证失效 | 撤销旧操作权限，保留草稿，明确断线，不自动重发 |
| 项目关闭/卸载 | 等待当前和正在退休的连接、broker、JCEF 资源释放 |

正常态每个项目当前规范化 cwd 一个 Core；多模块不自动创建多个 Core，不新增全 IDE 连接池。空间切换允许短暂新旧进程并存，旧连接立即失去事件权限且退出有界。

清理顺序：有界尝试中断/取消/取消订阅 → 关闭 stdin → 正常终止 → 强制终止。Node 当前共享 RPC 宽限 1 秒、各退出阶段 2 秒可作初始对照；Kotlin 按平台实测声明总预算并断言 PID 消失。Windows 验证进程树，不能只 kill 父 PID。IDE 被强制终止时的 EOF/子进程行为独立测试，失败阻止该平台发布。

## 7. 认证、空间与昂贵操作

当前 CLI 参考链路为 `auth status --json`、`auth login --json --force`、`__host-serve`；空间用 `project_list` / `space_prepare`。实现时按锁定代码核实完整参数；不调用 `space_commit` 改用户全局空间。

| 用户操作 | 业务调用目标 | 进程与初始化约束 |
| --- | --- | --- |
| 展开模型/空间菜单、取消面板 | 0 认证、0 RPC | 0 新进程 |
| 已登录且可自动选空间的首次连接 | auth/list/prepare 各 1 | 1 auth 子进程 + 1 临时 broker + 1 Core，各握手一次 |
| 必须等用户选空间 | 等待前关闭 broker；选择后重新 auth/prepare | 不跨用户等待复用材料 |
| 已有同账号目录的切换 | auth 1、list 0、prepare 1 | 新 Core 1，原会话保留到交接 |
| 主动刷新空间目录 | auth 1、list 1、prepare 0 | 不新增 Core |
| 普通 Core 目录刷新 | auth 1、对应 RPC 1 | 复用 Core，底层不再认证 |

上述统计与 Core 执行中按需调用凭据 broker 分开；同时记录业务请求数、实际进程数和握手数。浏览器用户等待单列，不混入机器处理耗时。完整初始化结果在同次无用户等待事务内复用，但授权不无限缓存。

MCP 敏感参数/环境变量使用 JetBrains 平台安全存储，锁定 SDK 后核实 API；不能写入项目文件、普通设置或 Webview state。目录缓存不是权限依据，共享账户在另一 IDE 变化后必须由后续认证检出。

## 8. Kotlin 历史重放

不能实现成“读取最后 N 行”。需要保留用户 invocation 边界、隐藏模型输入、工具关联、clear/rewind、后台记录和消息顺序。

1. 使用与 Core 一致的目录规则；当前为 `LINCO_SESSIONS_ROOT` → `LINCO_HOME/sessions` → `~/.codem/sessions`，实施前复核。
2. 验证 header 身份、schema 13、cwd、序号、符号链接及 blob 完整性。UI 仅提交 threadId/不透明 cursor。
3. 流式读取且可取消；尾部无换行的半条写入与完整坏行分别处理。
4. cursor 绑定文件身份/修订；append、rewrite、clear 后不得拼旧页，显式要求重新加载；读取中变化不发布半快照。
5. 先重放，再按轮次分页并按时间顺序显示。不新增 SQLite、持久索引或 transcript 存储绕过语义。
6. 运行中持久快照不覆盖实时 parts；空闲恢复用持久投影。失败保留现有消息，不回退到实时 RPC 冒充历史。

最低共享样例：多轮、空白流、交错工具/失败/无结果、图片/blob、隐藏输入、后台轮次、clear、rewind 各支持范围、尾部半行、完整坏行、重复/乱序、身份不符、路径穿越/符号链接、blob 缺失/校验失败、取消、读取中改写、分页后 append。

两端规范化结果逐字段对比，只允许测试明确声明的临时目录等环境差异。大文件记录扫描量、峰值保留状态和取消耗时；不声称内存恒定，去重集合和活跃聚合可能随记录增长。

## 9. UI、资源与原生编辑器

### 9.1 JCEF 与桥

使用 Tool Window，先检测 JCEF 支持；不可用时原生说明页和诊断入口，不暗中转外部网站或再建聊天实现。[JCEF 官方文档](https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html)

只加载打包资源；资源路径与 MIME 有白名单，拒绝穿越。限制导航/弹窗，外部页面不能取得消息桥；外部链接经宿主策略用系统浏览器打开。安全渲染 Markdown/HTML/代码，CSP 不开放任意脚本。

消息使用 JSON 编码和严格校验，不将模型文本拼成 executeJavascript 源码。绑定视图代次，拒绝旧页面操作；ready 前不发送会丢失的关键消息。原子获取当前快照并订阅更新，使用单调版本防止旧快照覆盖新事件。

可合并渲染刷新，不可丢文本增量、审批或终态。慢 UI 队列有界并能重新同步，不无限积压整份快照。

### 9.2 共享 UI 迁移

`@codem/ui` 提供挂载/释放及窄宿主接口：发送操作、订阅状态、草稿存取、主题、资源引用。不注入整个 Host/Controller，也不伪造 acquireVsCodeApi 保留隐藏耦合。

两端映射 CodeM 主题 token，统一字体、缩放、焦点、菜单宽度和滚动边界。继续 shadcn/ui；手写部分按独立组件边界替换，不附带全量 React 重写。迁移同时更新 CSP nonce、Tailwind 扫描、构建、许可和模拟预览。

可用性由“Core 支持 + 宿主确已实现 + 状态允许”决定，宿主仍独立验证操作。没有实现的功能不因共用组件而呈现可点击入口；此能力描述不扩展为通用插件系统。

### 9.3 原生编辑器语义

- 当前选区读取 Document 快照、版本及范围；未保存内容不能以磁盘内容冒充，也不自动保存项目。
- 文件/目录附件遵循 Core 语义；`supportsVision=false` 不能直接阻止图片，当前 Core 可走图片工具。
- 发送前重新校验附件，失败保留；数量/大小上限沿用已确认产品规则并双端验证。
- 文件定位只接受宿主绑定的资源；不信任模型路径，覆盖 VFS 刷新及无效对象。
- 首版 Diff 是原生只读查看，区分完整补丁、部分、二进制和缺失预览，不将缺失显示成无修改。
- 后续接受建议须校验文档版本、支持撤销和逐块处理；Core 已执行的修改不能再次应用。

## 10. 能力台账：从接口到用户效果

以下均为目标，当前 IDEA 尚未实施。A 为首版闭环，B 为完整 Agent 能力，C 为延期原生增强，X 为未支持/范围外。A 完成只能称首版，不能宣称“能力已接满”。

每个 ID 必须补齐：版本及依据、用户入口、Kotlin 方法、请求/事件、状态所有者、正反向测试、模拟 UI、真实 Core、真实 IDEA 证据。被动事件必须有展示/清理效果，不以“已解析”结项。

| ID / 阶段 | 能力入口 | 关键语义与准出 |
| --- | --- | --- |
| A01 | 登录页、账户状态/刷新 | 浏览器取消/失败可恢复，无项目可登录，不读凭据文件 |
| A02 | 连接、工作目录/空间及刷新 | 调用次数达标，切换失败保留原会话，不改全局空间 |
| A03 | 模型、强度、Agent/Plan、权限 | start/resume 与 modes read/set 分清；expectedRevision 冲突可见 |
| A04 | 发送、流式、停止、新建 | 回执/终态竞态、草稿保护、Core threadId、连接复用 |
| A05 | 文本、思考、工具、子代理活动 | callId 关联、空白保留；失败/中断/未完成不显示成功 |
| A06 | 命令/文件/权限审批 | 仅有效请求及允许选项可回复，跨会话拒绝，拒绝/取消明确 |
| A07 | 多题问答、计划确认 | 返回上题、自由文字、取消、拒绝反馈、重载恢复 |
| A08 | 历史列表、分页、恢复续聊 | 归属校验、JSONL 唯一来源、原 threadId 续聊 |
| A09 | 选区、文件、图片、目录附件 | 未保存选区、失效附件、失败保留、真实图片识别及恢复 |
| A10 | 文件引用、变更统计、原生 Diff | 拒绝路径逃逸，部分/二进制提示，真实 IDE 定位 |
| A11 | 计划、用量、activity、差异汇总 | 进度不当终态，用量不冒充费用账单 |
| B01 | 改名、分叉、归档、解除归档、删除 | 目标验证、破坏操作确认、结果不明不重试、分叉可恢复 |
| B02 | 清空上下文 | 新旧身份校验、旧句柄撤销、清空后再发送 |
| B03 | 压缩、回退检查点/范围 | 等真实控制终态，可取消，重新读取历史 |
| B04 | 运行中补充指令 | turn/steer + expectedTurnId/submissionId，不误建轮次，保护草稿 |
| B05 | 旁路提问与取消 | 独立答案/终态，核实并发约束后实现 |
| B06 | Skills 目录及选择调用 | 原生结构化 skill 输入，不拼 slash 文本；目录失效及附件组合校验 |
| B07 | Shell 入口 | 用户确认，经 Core 执行，空回执不代表成功，验证实际效果 |
| B08 | 额外工作目录 | 原生选择、规范化授权、同 thread resume，不等同目录附件 |
| B09 | 后台终端列表/日志/终止/清理 | PID/taskId 分离，alive 字段按版本映射，日志有界安全 |
| B10 | 后台任务、取消、唤醒 | 空闲仍消费 wake，主动轮次完整审批和终态，不复活旧轮次 |
| B11 | MCP stdio 设置和工具目录 | 安全存储、正确线程应用、真实 fixture 工具调用，目录不冒充健康检查 |
| B12 | 环境/配置/Hooks/插件/权限档案/Provider/Core 空间目录 | 按需、脱敏，Core 空间快照不代替 broker |
| B13 | loaded/turns/items 快照及分页 | 标明诊断快照，cursor 按锁定契约，不作为持久历史 |
| B14 | 工具保护、Hook、线程状态/关闭/清空、目录变更 | 事件到 UI/失效动作，Hook 成败与轮次终态分开 |
| C01 | 修改建议、诊断修复、逐块接受/撤销 | 单独设计；只读 Diff 不等于此能力完成 |
| C02 | 终端上下文、提交说明、行内补全、多聊天位置 | 平台成本独立评估，不虚设入口 |
| X01 | MCP HTTP、配置写入 | 旧基线能力为 false；0.8.45 复核，未证实前无入口 |
| X02 | CLI 全局空间/全局退出、插件/Hook 安装编辑 | 不属本轮产品范围；底层方法存在不构成接入授权 |
| X03 | Remote Development、其他 JetBrains IDE、跨 IDE 实时协同 | 不声明支持，各自约束独立立项 |

B03 风险：0.8.44 compact 曾实测缺正常终态，0.8.45 必须重测。仍存在时保留停止/诊断并标受阻，不能把 warning 或超时转换成功。其他上游缺陷同样处理。

防止“有接口但用不上”的门禁：

- 每个范围内 RPC 映射真实操作或必要内部流程；每个入口有成功、失败和取消结果。
- 范围内 Item/通知都有领域事件、状态变化和展示/清理效果。
- 新发现能力明确归 A/B/C/X；未实现 A/B 阻止对应里程碑完成。
- 验证 Skill 实际调用、MCP 实际工具执行、wake 后续轮次等效果，不只断言目录非空或方法返回。
- 不为覆盖率增加未经授权的写入；只读插件目录不意味着要做安装按钮。

## 11. 构建、依赖与分发

TS 沿用根 pnpm 锁文件、catalog、TypeScript 7.0.2、Oxlint。Kotlin 提交 Gradle Wrapper，明确 toolchain 和依赖锁定/校验，不依赖全局 Gradle。[官方构建文档](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html)

可为 `apps/jetbrains` 增加 package.json 编排 workspace 检查，但它不是生产 Node 依赖。包装命令必须跨平台并传递退出码；Gradle 声明 UI/contracts 为输入，避免重复构建，干净 checkout 可复现。

Core/CLI 版本与平台映射只保留一个机器可读发布事实来源。先检查现有 staging manifest 是否够用；不足时在专门 Cycle 抽取中立数据并原子更新 TS/Gradle，不能长期各写一套版本常量。二进制不放 contracts 样例包。

首包携带目标平台 Core、认证程序、许可证、哈希清单、UI，不包含 node_modules、测试历史或独立 Node。二进制/资源完整性失败明确报错，不回退到 PATH 未知版本。

多平台发布前核实 Marketplace 包/更新机制，不能假设 VSIX target-specific 机制直接适用。比较合包大小、按平台获取、离线使用与升级原子性，再决定；不先承诺首次联网下载或自动发布。

## 12. 性能与可观测性

记录操作 ID、能力 ID、阶段、耗时、请求/进程次数及脱敏错误类别，不记录 token、原始 CLI 响应、用户内容或完整路径。日志有界，导出诊断由用户触发。

确定性门槛：菜单零后端调用；一次连接无重复初始化；UI 重载零新增 Core；无 EDT 阻塞等待；在声明预算内退出；自有 PID 消失；结果不明零自动重试。

测量 ZIP/安装大小、各二进制大小、JCEF/Core 前后内存、首屏可交互、认证/空间/Core/模型阶段、首个流式更新、大历史重放与取消。注明硬件、OS、IDE、版本、冷热状态、样本数。首轮工程基线制定可执行阈值；没有测量不写提升百分比，模型网络等待与本地处理分开。

## 13. 实施路线和准出

以下是未来任务分解，不代表本次开始实施。每次按用户授权范围推进；完成并验证的独立 Cycle 创建只含本轮改动的 commit，不自动 push。

| Cycle | 依赖与边界 | 交付与准出 |
| --- | --- | --- |
| 0：版本/工程基线 | 无；IDEA 骨架、构建/测试/打包、版本决策 | 干净 checkout 构建，唯一开发宿主加载，JCEF 可用/不可用路径，单平台体积/耗时，SDK 矩阵和性能阈值 |
| 1：contracts/Core transport | 0；最小 contracts、Kotlin 帧/RPC/进程 | 双端正反向样例，fake 子进程乱序/挂起/崩溃/回收，真实锁定 Core 仅握手 |
| 2：认证与纵向链路 | 1；A01–A07 最小链路 | 无系统 Node 环境登录/发送/审批/停止，调用次数达标，关闭无遗留，体积/耗时实测 |
| 3：UI/协议迁移 | 2；消息、输入/菜单、审批、历史分别子 Cycle | 双宿主共用 UI，原子迁移 VS Code，构建/CSP/主题/预览验证，删除被替代入口 |
| 4：history 改名 | 1 后可独立；仅包名与路径 | workspace/import/构建/测试/文档全部迁移，无旧别名，归档排除不误伤，默认检查通过 |
| 5：Kotlin 历史/恢复 | 1、3、4；A08 和第 8 节 | 双端历史一致，真实关闭重开并续聊，损坏/改写/分页/取消正确 |
| 6：编辑器/首版闭环 | 3、5；A09–A11，所有 A 项收敛 | 真实 IDEA 完整路径，未保存选区/图片/Diff，窄栏展开菜单/主题/IME，VS Code 回归 |
| 7：会话控制/Agent 输入 | 6；B01–B08，逐能力子 Cycle | 会话管理、steer、旁问、Skill、控制轮次、Shell/目录实际可用，确认/竞态覆盖，上游缺陷如实受阻 |
| 8：后台/MCP/诊断 | 6；B09–B14，逐边界子 Cycle | wake/取消、MCP 工具、目录快照、事件呈现、安全存储/脱敏/回收 |
| 9：分发收敛 | 首版依赖 6，完整版依赖 7/8 | 无 Node 安装验证、目标 OS/IDE 矩阵、Plugin Verifier、升级/卸载/异常退出、体积/许可证；不含发布 |

Cycle 2 可用最小诊断展示，但必须标为技术验证，不演变为第二套手写正式界面。UI 迁移一次一个完整边界，旧的未迁移组件可保留，已迁移边界不留旧默认路径。

## 14. 验证体系与 CI

| 层次 | 证明范围 | 不能替代 |
| --- | --- | --- |
| TS/Kotlin 单元与 contracts | 字段、时序、错误、历史投影 | 真实 Core 行为 |
| fake 子进程集成 | 半帧/乱序/挂起/崩溃/取消/回收 | 生产二进制平台验证 |
| 模拟 UI | 首屏/菜单/焦点/草稿/滚动/重载 | JCEF/IDE 原生操作 |
| 真实 Core 无模型 | 握手、目录、受控临时会话操作 | 模型工具执行 |
| 真实 Core 有模型 | 流式、审批、附件、Skill/MCP、后台、历史效果 | 用户在 IDEA 内完成操作 |
| 真实 IDEA | 入口到效果、编辑器、JCEF、生命周期 | VS Code 无回归 |
| 真实 VS Code | 共享 UI/协议原客户端回归 | IDEA 验收 |

默认检查不登录、不访问账户、不调用模型；真实测试显式触发，在明确临时工作区执行并记录文件/会话写入和清理范围。用户历史不充当 fixture。

当前已有 `pnpm check`、`pnpm build:vscode`、`pnpm test:architecture`、`pnpm test:shutdown`，它们目前不覆盖 Kotlin，不能用其通过声称 IDEA 合格。

工程落地时新增 JetBrains build/check/contracts/runtime/live/UI 入口，名称在应用 README 明确。以下是目标要求，不是假定命令已存在：

- 根 `pnpm check` 纳入无 GUI、无真实账户的 contracts/Kotlin 检查；JDK 缺失明确失败，不能静默跳过。
- Kotlin 编译/静态/测试与 TS 分别报告；Oxlint 不覆盖 Kotlin。
- contracts 改动检查所有消费者；UI 改动检查预览/双宿主；进程和二进制改动检查目标 OS。
- 架构门禁覆盖 UI 禁入 Node/编辑器依赖、跨 app 内部引用、归档误引用、旧包生产引用；规则有正反向测试。
- A/B 台账状态和证据完整，不能按测试数量宣称覆盖。
- 发布前 Plugin Verifier 与真实安装均通过，不能互相替代。[兼容验证](https://plugins.jetbrains.com/docs/intellij/verifying-plugin-compatibility.html)

GUI 先复用已有会话，默认一个 IDEA 开发宿主、一个 VS Code 开发宿主和一个浏览器会话。确需隔离先说明理由；记录本 Cycle PID/窗口，只清理本任务创建的资源。

## 15. AI 执行约定

### 15.1 开始前

1. 读取根规则、本方案对应章节和实际代码/测试；检查工作树，保留其他任务改动。
2. 写明能力 ID、当前问题、业务不变量、目标边界、状态所有者、保存和清理范围。
3. 给出用户事件 → UI → 宿主 → Core/CLI → 事件 → UI 调用链及每次昂贵操作必要性。
4. 区分事实、目标、历史偶然行为、未确认项；涉及 SDK 时先核实锁定版本官方文档。
5. 为首次、重复、取消、失败、重载、上下文切换列断言；迁移列出所有旧入口和消费者。
6. 产品语义或外部接口缺证据时只暂停依赖部分，不用默认值/降级替用户决定。

### 15.2 编码要求

- 边界类型和非法状态先明确，未知输入经解析后进入领域；禁止强制类型转换绕过校验。
- 错误区分协议、认证、取消、业务冲突、结果不明、进程退出；含操作/阶段/安全关联 ID。
- 成功、失败、取消走资源所有者的清理路径；不吞异常、不遗留无主协程，不把销毁进程当成功。
- 一个业务规则只有一个实现所有者；UI 禁用不替代 Host 校验，不复制共同可变状态。
- 测试证明效果及错误被拒绝，不镜像实现、不改 expected 掩盖错误、不跳过失败用例。
- 修复先定位根因，回归用例能失败于旧实现；不用 sleep、无限缓存或重试写入修补竞态。
- 内部迁移原子更新并删除旧入口；真实外部兼容约束才允许带退出条件的兼容层。
- 引入 JVM JSON/协程依赖前核实 SDK 自带版本与 classloader 约束，不重复打包冲突库。
- 不把所有逻辑放一个 Service/Controller，也不按行数拆散一起变化的状态与清理规则。

### 15.3 交付模板

```text
Cycle / 能力 ID：
结果与用户可观察变化：
基线版本 / 目标 IDE / 平台：
修改边界与状态所有者：
生产入口 → Core/CLI → 事件 → 展示证据：
首次 / 重复 / 取消 / 失败 / 重载 / 切换：
认证、RPC、进程次数与阶段耗时：
单元/集成：通过 / 失败 / 未执行 + 命令/证据
模拟 UI：通过 / 失败 / 未执行 + 证据
真实 Core 无模型 / 有模型：分别报告
真实 IDEA / VS Code：分别报告
旧引用：生产 / 测试 / 文档分别说明
兼容/上游缺陷：对象、版本、退出条件
未完成与阻塞：不得用“基本完成”省略
commit：仅本 Cycle，未授权不 push
```

### 15.4 完成标准

首版要求 A01–A11 完成；完整 Agent 版本要求范围内 B01–B14 完成。上游受阻须显式记录并由产品接受缩减范围，AI 不得自行降级宣称完成。C/X 保持在范围记录中。

完整用户操作、契约一致性、资源回收和双宿主回归共同构成交付证据。接口存在、按钮可点、截图、测试数量或模型自述均不能单独证明质量。

## 16. 本文交付范围

本轮只新增方案及 README 入口，未创建 JetBrains 工程、未改名包、未抽取 UI/contracts、未改 Core/VS Code 生产行为。

文档验证范围：本地引用存在、能力/阶段覆盖、版本与源码一致、diff 空白及只含本轮文件的提交。未运行单元/集成、模拟 UI、真实 Core、真实 IDEA 或真实 VS Code；引用既有记录不等于重新验收。
