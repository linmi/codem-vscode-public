# 代码质量门禁

本轮把既有架构边界和关闭生命周期要求接入默认检查，不新增生产依赖。它们约束已知风险，不代表所有交互或所有恶意绕过都已覆盖。

## 运行入口

```bash
pnpm check                 # lint、类型检查、全部 fixture 测试，以及 JetBrains 域检查
pnpm test:architecture     # 架构边界及门禁自身的正反向验证
pnpm test:shutdown         # 退出生命周期故障场景
pnpm build:vscode          # 验证插件可以构建
pnpm check:jetbrains       # JDK 21 + Gradle 域测试；JDK 缺失必须失败
```

`.github/workflows/quality.yml` 在 PR 和 main 推送时运行检查与构建。使用 Node 22.23.2、pnpm 12.4.1 和冻结锁文件；只读仓库权限，不调用模型。工作流仅在推送后才会执行；要禁止绕过失败检查合并，需要仓库管理员将 `Quality gate` 配为必需检查，本轮未修改远端设置。

Actions 的选型和参数依据 [checkout 官方文档](https://github.com/actions/checkout) 与 [setup-node 官方文档](https://github.com/actions/setup-node)，均固定到已核对的 v7 提交。静态类型导入限制使用现有 Oxlint 1.83.0 的 [no-restricted-imports](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports)，并通过实际执行该版本的反例验证。

## 架构门禁

| 约束 | 执行机制 | 故障注入 |
| --- | --- | --- |
| 活跃生产代码不能依赖 `history/` | esbuild 在内存中解析生产入口；检查原始引用、实际解析路径及符号链接；静态 import/export 同时受 lint 约束 | import、export、字面量动态 import、require、TS 路径别名、符号链接 |
| 共享包保持独立于应用和编辑器 | Node 服务拒绝 VS Code、Electron、React；`@codem/ui` 可用 React/shadcn，仍禁止 Node/VS Code/Electron/app-server/history | 编辑器类型导入、Electron 动态导入、相对路径进入应用 |
| 共享包没有 DOM 环境 | 明确的 ES lib 和 Node/空 types；默认 tsc 检查 API 使用 | 添加 DOM lib 或 vscode ambient types |
| 协议包保持可移植、无运行时依赖 | 拒绝外部运行时导入及 dependencies/peerDependencies/optionalDependencies | Node 内置导入及三种依赖声明 |

检查只编译解析，不执行应用、启动 Core 或写入 bundle。负向测试在系统临时目录构造小工作区，结束后删除，不污染真实源码。使用现有 esbuild，不新增解析器或规则框架。

边界：检查生产 `src/` 和 Webview；不审计第三方依赖内部实现，也不能静态判定运行时拼接路径、eval 或全部类型别名。类型导入检查与运行时依赖解析互补，不把字符串正则扫描当作完整依赖图。

## 跨语言契约门禁

JetBrains 发行包不带 Node，Kotlin 端保留自己的协议实现；漂移由测试发现。Gradle `test` 通过 `codem.contracts`、`codem.sessionRecordContract` 读取共用样本，并把 `packages/contracts/{manifest.json,core,webview,history}` 与 `session-record-contract-v13.json` 声明为测试输入，样本单独改动也会重跑，不会 UP-TO-DATE 跳过。

| 样本 | TypeScript 侧 | Kotlin 侧 |
| --- | --- | --- |
| `core/knownNotifications.json` | 等于 `APP_SERVER_KNOWN_NOTIFICATIONS` | 等于 `KnownNotifications.methods` |
| `core/jsonText.json` | 每例与 `JSON.parse` 一致 | `JsonValue` 同样接受（含键顺序）或以 InvalidJson 拒绝 |
| `core/itemProjection.json` | 与 `parseAppServerItem` 的 toolName、callId、input、finalAnswer 一致 | `CoreItemProjection` 推导相同字段或以 InvalidFrame 拒绝 |
| `webview/*.json` | `parseUiAction` | `parseViewAction`、`encodeChatSnapshot(initialSnapshot())` |
| `session-record-contract-v13.json` | 读取器按类型分派 | 每个类型须明确投影或隐藏，契约外类型报告在 `HistoryPage.unknownRecordTypes` |

2026-09-25 反向验证：在已知通知样本增加方法、改动 webview 样本、在记录契约增加类型，对应 Kotlin 测试均失败；去掉 Gradle 输入声明后同样的样本改动被 UP-TO-DATE 跳过。新测试在修复前的 `JsonValue` 上失败，同等行为探针在修复前的 `TurnAccumulator` 上失败（`\uZZZZ` 抛出 NumberFormatException 越过 RpcPeer、深嵌套栈溢出、子任务/上下文整理标签、final_answer 被丢弃、原始 activity 文本透传）。

边界：活动文案只存在于 VS Code `chatController.ts`，不在共享包中，Kotlin 测试按其现值断言，不能随 TypeScript 改动自动失败；`toolPresentation` 键与 `parseAppServerItem` 工具名的一致性由 TypeScript 侧自身保证。

### JetBrains JSON 字段读取

Kotlin 解码统一经 `JsonValue.ObjectValue` 的类型化读取：`requiredX(key, path)` 缺失、null 或类型不符以 InvalidFrame 失败并带字段路径；`optionalX` 视缺失与 null 为缺省、其它类型失败；`xOrNull` 为宽松读取，只用于宽松是既定行为（Node Host 同样宽松或现有测试固定）、或调用方随即以自己的错误类与消息失败的字段（身份比对、History/Validation/Capability 错误）。`JsonCastGuardTest` 扫描 `src/main` 与 `src/plugin`（经 `codem.kotlinSources` 注入并声明为测试输入），除允许清单中的 `JsonValue.kt` 外，出现 `as? JsonValue.X`（含包名限定与从 `JsonValue` 导入的嵌套类型）即失败；`is JsonValue.X` 模式匹配不受限。正反例覆盖直接、带空白、导入与包名限定四种写法，以及注释、其它类型的 `as?` 与 `is` 分支。

2026-09-25 反向验证：只在 `src/plugin` 插入两处转换，测试照常重跑并逐行报出；移除后通过。迁移前活跃源码共 127 处（120 行）此类转换，迁移后为 0。

## 目录组织门禁

VS Code 应用按[目录职责](sourceOrganization.md)组织。`sourceLayout.test.ts` 检查入口目录只保留组装文件、功能目录有明确归属，`webview/` 只有入口、样式入口和 `host/`；反例覆盖旧平铺路径、无归属目录及重建组件/输入区/样式副本。`webviewStyles.test.ts` 要求 VS Code 样式等于共享 `@codem/ui` 样式加 `body.vscode-*` 限定的主题桥接。`productionReachability.test.ts` 要求 `src/` 与 `webview/` 下每个 TypeScript 文件都能从 `scripts/support/productionEntries.ts` 列出的正式入口（扩展、Webview、原生 Chat 实验，两个构建脚本共用这份清单）到达：运行时依赖取 esbuild 解析，仅类型引用取 `tsc --listFilesOnly`，只被测试或其他死文件引用的文件同样报错；反例覆盖孤立文件、仅被孤立文件或测试引用的文件、孤立类型与移除入口，正例覆盖值、类型、再导出、动态导入、`require` 与声明文件。架构解析检查 Webview → 共享契约、共享契约 → 纯代码的依赖方向，含别名解析与类型导入反例；基础组件边界由 `@codem/ui` 的 UI 规则负责。全部进入 `pnpm check`。

## 文件命名门禁

`apps/vscode/tests/fileNaming.test.ts` 检查 `apps/` 与 `packages/` 下代码文件（`.ts`、`.tsx`、`.mts`、`.cts`、`.js`、`.jsx`、`.mjs`、`.cjs`、`.kt`、`.kts`）的文件名第一个点之前不含 `-`，即不使用 `xx-xx` 命名。文件清单取 `git ls-files --cached --others --exclude-standard`：已跟踪文件加未被 `.gitignore` 排除的新文件，依赖和构建产物不进入检查，尚未暂存的新文件同样会被拦截；调用 git 前去掉 `GIT_*` 环境变量，避免在 git hook 中读到其他仓库。归档 `history/` 不在范围内。

唯一例外是 `packages/history/src/shared/`：它是 CodeM Desktop reducer 的选择性复制（来源见 `UPSTREAM.md`），保留上游文件名便于逐文件对照后续导入，不改名。例外写在 `fileNamingChecks.ts` 的 `UPSTREAM_NAMING_EXCEPTIONS`，新增例外须写明来源。

正例覆盖 camelCase/PascalCase、`.test.ts` 与 `.d.ts` 后缀、Gradle 脚本、非代码文件、被忽略的构建与依赖目录、归档、上游复制目录，以及已从磁盘删除但仍在索引中的文件；反例覆盖每种扩展名、测试与声明文件、JetBrains Kotlin、例外目录的同级目录与前缀相近目录，以及未暂存的新文件。2026-09-25 在改名前的 main 上运行，该检查列出 `packages/app-server` 的 `control-plane.ts`、`rpc-abandoned.ts`、`control-plane.test.ts`、`protocol-alias.test.ts` 并失败。进入 `pnpm check` 与 `pnpm test:architecture`。

## 预览场景挂载门禁

Webview 预览（`tests/webviewPreview.ts`）操作的是生产 `@codem/ui`。预览运行时依赖的界面元素集中在 `tests/previewHooks.ts`。`previewHooks.test.ts` 用 esbuild 打包真实 `ChatApp`，对每个预览场景先经生产 `VscodeHostBridge` 投影 fixture，再以 `react-dom/server` 渲染，用 `markupQuery.ts` 查询：

- 样例已提交的判定（外壳 `data-phase`、运行详情 `data-thread-id`、工作区标签）命中；
- 各场景入口元素存在且可用：会话命令的输入框与带 `/命令` 草稿的提交按钮、本地菜单触发器、运行详情、资源面板、活动折叠项；
- 会话命令场景要打开的命令在斜杠菜单目录中，且对该 fixture 可用；
- `preview.css` 中 `body > …` 布局选择器命中 Webview 实际挂载结构。

反例：旧 `#slashCommandsHost[data-thread-id]`、`data-menu-scope`、`body > .app`、`#accountRoot` 不命中；其他线程或阶段的判定、空草稿提交、待审批时的输入框均不命中；不支持的选择器语法直接报错，避免误判通过。把运行时入口改回 `#slashCommandsHost` 或把样式改回 `#accountRoot` 时，该测试均实际失败。

边界：服务端渲染不包含 portal 与交互后才出现的内容（cmdk 菜单项、对话框内部、Select 选项），这些步骤只能在浏览器中逐场景打开验证；运行时在浏览器中等待超过 3 秒仍会抛出 `Preview surface did not mount`。门禁不启动浏览器，不新增依赖。

## 样式层级门禁

`packages/ui/tests/stylesheetCascade.test.ts` 编译真实的 `@codem/ui/styles.css`，在 PostCSS 语法树上检查三件事：`@layer base` 排在 Tailwind `utilities` 之前；只按元素类型（或 `*`）匹配的规则不能无层，否则会压过全部工具类（伪类参数里的类名不算限定，只定义自定义属性的令牌规则除外）；`!important` 只允许出现在 base 层（`[hidden]` 与减少动态效果）。另断言按钮重置、悬停、`html`/`body`、`[hidden]` 确实编译进 base 层。反例覆盖无层的元素重置、`*` 重置、`@media` 内的元素悬停、类名只出现在 `:has()` 里的元素规则、产品规则与其他层里的 `!important`、base 排到 utilities 之后；正例覆盖 base 层规则、限定作用域的组件规则、`:root` 令牌与 keyframes。修复前的 main 编译结果在该检查下有 25 处违规。检查不判断组件规则是否合理覆盖了 shadcn 样式，这部分仍靠评审和界面实测。进入 `pnpm check`。

同一文件还把 `ChatApp` 首帧渲染成静态标记，检查 `.类名[data-slot="…"]` 形式的选择器：该类名出现在标记里时，`data-slot` 必须至少命中其中一个元素，拦截 asChild Trigger 换掉 Button `data-slot` 后永远不生效的尺寸规则。它要求顶栏“文件与工具”和“运行详情”入口出现在首帧，避免检查落空；只出现在弹层或后续状态里的类名不在覆盖范围内。旧的两条 `[data-slot="button"]` 规则在该检查下失败；反例覆盖被替换的 slot，正例覆盖仅类名、匹配的 slot 与未渲染的弹层类名。

同一文件还按 `styles.css` 的引入清单逐个解析源样式文件，要求同一选择器（连同所在 `@media`/`@supports`/`@keyframes` 上下文）只由一个文件定义，拦截后引入文件静默覆盖前一份的重复规则；同一文件内“分组加特例”的写法不在此列，跨文件的不同上下文也允许。整理前的样式在该检查下有 48 处跨文件重复；反例覆盖根层、同一 `@media` 与同名 keyframes 的重复，正例覆盖分组规则、不同上下文与单一归属。

## 结构整理门禁

评审要求：按变化原因组织职责；状态只有一个所有者；接口只暴露必要能力；入口仅组装和协调。禁止用整个 Controller、万能 context 或共享可变对象连接拆出的模块。每轮写清不变量，原子迁移调用方并删除旧实现，不预建通用框架，不以行数阈值判定设计质量。

2026-09-20 为旧 VS Code 输入状态模块加入的 Oxlint 导入限制、独立 `tsconfig.composer.json` 和状态测试，已于 2026-09-25 随该模块一并撤销：它从未进入生产 bundle，生产输入区是 `@codem/ui` 的 `ChatApp`，回执规则由 `packages/ui/src/chat/draftRetention.ts` 及其测试负责。Oxlint 的 `no-restricted-imports` 正则不支持前瞻（见[官方规则说明](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports)），新增同类规则时仍用 `group` 与排除项并配反例测试。

### 输入区整理：目标与行为约束

> 以下两节是 2026-09-20 旧 VS Code 输入区的历史记录，所述 `composerState.ts`、`composerView.ts` 与 `ComposerSubmission` 已删除。

当前问题：`main.ts` 同时拥有草稿、输入模式、提交修订、Host 同步状态；`saveDraft()` 混合持久化、输入控件更新和会话工作状态展示。

目标：`composerState.ts` 独立拥有草稿、模式、作用域与提交修订；`composerView.ts` 适配输入区 DOM、既有 shadcn 菜单和 Host 消息；`main.ts` 组装输入区并展示会话状态。状态模块不依赖 DOM、编辑器、视图组件或主入口。现有 `ComposerSubmission` 作为内部回执规则继续复用，不复制规则。

| 操作 | 必须保持的结果 |
| --- | --- |
| 首次打开 | 从 Webview 保存值初始化普通草稿；Host 恢复消息到达前不发送草稿变更，恢复后以 Host 为准 |
| 输入与重复提交 | 编辑即时保存；一个待确认提交只能发送一次；展示更新不产生重复草稿同步 |
| 成功、失败、迟到回执 | 仅匹配且未编辑的成功回执清空输入；失败保留草稿可重试；旧回执不消费新输入 |
| 模式切换 | 普通草稿与最近一个工具草稿分别保留；切换视为修订，旧成功回执不清空切换后的内容 |
| 取消 | Shell 确认取消不发请求、不占用提交状态、不丢草稿；停止运行仍由 Host 处理 |
| 工作区、空间、会话切换 | 工具模式返回普通对话，工具回执失效；工具草稿仅在相同作用域与模式恢复。普通消息首次创建 thread 时保留待确认提交 |
| 重载、侧栏与标签页迁移 | Webview 保存普通及最近工具草稿；Host 恢复当前草稿与匹配的待确认消息 ID；展示模式从普通对话开始 |
| 加入编辑器上下文 | 校验长度后一次性更新普通草稿，失败不改内容；通过 `contextAdded` 确认，不再额外同步中间草稿 |

所有权与清理：Host `ChatSurfaces` 保持跨界面草稿和待确认消息的既有所有权；Webview `ComposerState` 是当前编辑副本的唯一所有者；DOM 仅显示和转交输入。工具草稿保存最近一项（不新增多会话缓存）。重载销毁旧 Webview 的事件监听、React roots 和 ResizeObserver，新界面通过现有恢复协议初始化。本轮不引入局部卸载或第二个输入区。

调用链：用户输入 → 状态修订 → Webview 保存 → 必要时单次 `composerChanged`；提交 → 既有 Shell 确认（仅 Shell）→ 建立待确认状态 → 单次业务消息 → Host → 回执。没有新增认证、网络、RPC 或子进程，没有改变 Host 的授权和 Core 调用链。

准出：默认检查验证状态规则与依赖边界，并对非法依赖和过期回执提供反例；构建成功；模拟界面实际打开菜单，验证发送、失败重试、确认取消和状态保留。真实 Core 与 VS Code 层次单独报告，不用模拟结果替代。

### 输入区整理：2026-09-20 验收记录

- 单元/集成：`pnpm check` 通过；新增 10 项输入状态测试和 2 项结构门禁测试，覆盖失败重试、重复/迟到回执、新编辑保护、普通/工具模式、三个上下文维度、首次建线程、恢复 pending ID、快照隔离及超长上下文拒绝；既有回执和 Host 界面迁移测试继续通过。
- 构建与静态检查：`pnpm build:vscode`、`git diff --check` 通过；无新增生产依赖。默认类型检查增加输入状态的无 DOM/Node 全局环境。
- 模拟界面：复用 PID 53273 的 4318 预览服务；本任务只创建一个 Codex 内置浏览器标签页，浅/深色主题验证实际展开的命令菜单、键盘选择、Shell 确认取消与成功、旁路提问失败重试及草稿恢复、首次慢连接、停止后草稿保留和文件引用联动。浏览器错误/警告日志为空。预览不持久化 Webview 存储，因此重载草稿恢复由状态和既有 Host 测试验证，未称为浏览器持久化验收。
- 真实 Core：未运行；没有改变授权、RPC、连接或子进程实现。
- 真实 VS Code：未运行；侧栏/标签页切换与真实 Webview 重载的手动验收仍未完成。未新增或关闭用户的 VS Code 窗口。
- 迁移核对：生产 `main.ts` 不再持有草稿、模式、提交修订或同步标志；`saveDraft`、`applyingHostDraft`、`inputScope` 的旧实现已删除。草稿字段仅由 `ComposerState` 持有；`ComposerSubmission` 保留为复用的回执规则。测试引用新状态模块，文档中的 `saveDraft` 是迁移问题说明。
- 评审结果：输入规则集中且可独立测试；视图接口仅接收输入元素、消息传输、锁定状态查询与展示通知。状态模块没有视图/Host/主入口依赖，回执规则不反向引用状态模块。取消无提交副作用、失败保留与上下文切换已由上述分层证据验证；本轮不宣称完成全仓库结构治理。

## 关闭生命周期门禁

| 场景 | 必须观察到的结果 |
| --- | --- |
| unsubscribe、interrupt 或 side-question cancel 不返回 | 已建立连接共享最多 1 秒的优雅退出预算，随后关闭 transport；测试确认子进程 PID 已消失 |
| 子进程忽略 EOF 和 SIGTERM | 进入 SIGKILL 阶段，实际回收；正常机器预算不超过 7 秒，测试容许到 8 秒以容纳调度开销 |
| 重复调用 dispose | 返回同一个 promise；Host 尚未关闭时，任何调用均不得提前完成 |
| 协议异常先触发后台清理，再退出 | dispose 等待这项清理，不遗漏失去 session 引用的 Host |
| 切换空间、旧进程慢退出 | 新空间先可用，旧事件失效，最终退出等待所有旧 Host |
| 一个 Host 清理失败，另一个仍在关闭 | 等全部完成后聚合报告失败，不伪装成功或提前跳过其余资源 |

子进程 fixture 有独立的 9 秒 watchdog，保证旧实现或回归时测试失败并回收测试进程；不能靠 watchdog 通过验收。RPC 不返回的旧实现已被该测试实际拒绝，重复 dispose 和异常清理遗漏也已在修复前验证失败。修复保持实时终态只能来自 `turn/completed`，不伪造任务完成，不自动重发 RPC。

预算针对已建立的 Core 连接；认证、空间准备和初始化保留各自的取消/超时机制。Controller 退出会取消连接生命周期，迟到连接只能关闭，不能绑定或恢复界面。门禁不是对任意第三方回调执行时间的保证。

子进程终止方式由 `packages/app-server/src/processLifecycle.ts` 统一持有：Core 连接、登录、认证命令、空间凭据代理与插件命令各有一项显式策略（优雅或立即、是否终止进程树、每步等待）。默认检查断言 Core 策略在 1 秒释放后分三步等待仍不超过 7 秒，并断言只有插件命令终止进程树；升级到 SIGKILL、进程组回收和 Windows `taskkill` 分支均有故障注入测试。

## 验证层次

- 2026-09-20 本地结果：`pnpm check` 通过（217 个测试，含本轮 7 个关闭故障测试、13 个架构门禁测试）；`pnpm build:vscode`、`actionlint .github/workflows/quality.yml`、`git diff --check` 通过。测试总数包含同期其他任务的预览测试，不将它们计为本轮新增覆盖。
- 单元/集成：默认检查包含架构反例和真实子进程 fixture；不使用真实凭据。
- 模拟界面：本轮未运行，未修改交互布局。
- 真实 Core：本轮未运行；进程回收证据来自协议 fixture。
- 真实 VS Code：本轮未运行；未宣称退出、重载的完整 UI 验收通过。
- GitHub Actions：本轮仅本地校验工作流与等价命令，未推送或触发远端运行。

## 会话控制器状态边界

资源句柄、后台任务与历史读取分别由 `ConversationResources`、`BackgroundTasks`、`ConversationHistory` 持有。禁止这三个模块反向依赖聊天协调器、聊天界面容器或应用入口；默认架构门禁校验别名解析，Oxlint 校验类型引用，规则有正反向测试。控制器通过有限操作调用模块，不共享可写状态对象。

所有权、保存范围、清理时机及本轮分层验收见 [chatControllerBoundaries.md](chatControllerBoundaries.md)。回归覆盖旧异步操作不得恢复已清理状态、不得释放新操作的互斥，以及历史订阅状态不确定时必须断开。结构准出不使用行数或文件数量作为替代证据。
