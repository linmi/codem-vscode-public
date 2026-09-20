# App Server 能力接入

2026-09-20：按用户要求将 Core 从 0.8.37 升至 npm latest **0.8.44**，本机实际构建 `0.8.44+2725.g997c17f.dirty`，CLI 保持 0.1.208。本轮按[固定基线能力审计](appServerCapabilityAudit.md)补齐支持项。覆盖已知公开契约，不宣称枚举隐藏接口，也不能把接口已接入等同于所有真实操作已验收。

## 接入结果

| 能力 | 生产入口与行为 |
| --- | --- |
| 改名、分叉、归档、解除归档、删除 | `/rename`、`/fork`、`/archive`、`/unarchive`、`/delete` → 选择当前或已加载会话 → 确认操作；分叉可从刷新后的历史列表继续 |
| 清空 | `/clear` → 确认清空上下文；校验回执的 operationId、原身份、工作区和新 threadId，切换到新身份并撤销旧资源 |
| 主动压缩、回退 | 控制轮次；回退通过 shadcn Dialog/Select 选择 Core 提供的检查点及范围，任一步可取消；压缩存在下述上游终态问题 |
| 执行中补充指令 | `/steer` → 主输入框补充指令；使用 turn/steer、expectedTurnId、submissionId，不新建轮次 |
| 旁路提问、取消 | 主轮次空闲时启动，独立流式答案与状态；取消回执不替代 sideQuestion/completed |
| Skills | 按需读取 Core 目录，选择下一条消息的技能；原生 `{type:"skill",name,arguments}` 输入，不拼接 slash 命令；该输入与附件组合当前明确拒绝 |
| Shell | 输入命令并确认，经 thread/shellCommand 提交；Core 返回空回执，无输出预览，不把回执当成命令执行成功 |
| 额外工作目录 | 原生文件夹选择 → realpath/目录校验 → 同一 thread resume；独立于消息目录附件，仅当前连接有效 |
| 控制面目录 | 环境、配置、Hooks、插件、权限档案、Core 空间、Provider 能力按需读取；配置只展示键名/类型，Hook 只展示事件和处理器数量 |
| 实时快照 | thread/loaded/list 以及当前线程 turns/items 首分页；标明总数和后续页存在性，不替代 JSONL 历史 |
| 实时事件 | 计划、用量、差异汇总、工具保护、Hook 结果、线程状态和 activity 显示；警告使用安全文案，不下发原始命令/错误对象 |

已有附件、模型/权限/计划模式、审批/问答、MCP stdio、工具目录、后台终端与后台任务取消继续沿用既有链路。Core 声明 configWrite=false、mcp.http=false，不提供无效编辑或 HTTP 入口。CLI 全局空间写入和退出登录不是 App Server 本轮接入范围；空间切换继续只影响本连接。

图片输入补充核实：Core 0.8.44 在模型目录 supportsVision=false 时仍能接受 localImage，通过 describe_image 识图并保存可恢复的历史图片。客户端不再以该字段拦截图片发送；使用 `test:live --images` 验证实际内容识别和重连恢复，详见 [图片验收记录](interactionAcceptance.md)。

## 操作、状态与生命周期

- 首次打开面板不发 RPC；显式刷新目录才读取。目录归当前连接，实时快照归当前线程；每次刷新重新认证，不缓存认证结果。重复写入由 Host phase/busy 状态阻止，不自动重试。
- 实时计划、用量、差异汇总、工具保护和 Hook 结果仅为内存投影。新轮次清理轮次级状态，切换会话/空间清理投影；持久消息只读 Core JSONL schema 13。
- 补充指令和旁问通过独立请求回执确认，失败保留草稿；旧回执不能清除发送期间的新编辑。线程绑定及连接身份校验丢弃迟到结果。
- 会话写入只接受当前工作区列表或当前订阅的 ID，执行前 readThread 验证 cwd。删除/清空显示作用对象和确认按钮。结果不明时提示核对，禁止自动重试。
- 控制轮次只由 turn/completed 结束；结束后重新读取 JSONL，包括被中断的控制操作，因为 Core 可能已修改记录。读取失败保留现有消息并提供重新加载。
- 技能只接受当前 Core 目录中的名称；skills/changed、切换线程或连接使旧选择失效。路径与目录 ID 的映射只在 Host，Webview 仅取得安全显示名称和不透明句柄。
- Webview 重建由 Host 快照恢复状态，输入草稿通过 Webview state 保存；上下文变化清理目标相关表单。原生目录选择取消不变更范围。断线/重载撤销旧订阅和句柄。

## 调用次数与依赖

复用当前连接，不因打开工具面板创建 Core 或重复初始化。认证通过当前 session.authorize，控制面 RPC 不再自行重复认证。

| 用户操作 | 必要调用与顺序 |
| --- | --- |
| 打开面板 / 取消确认 | 0 次 RPC、0 次认证、0 个子进程 |
| 普通目录刷新 | 1 次认证 → 1 次目录 RPC |
| 实时快照 | 1 次认证 → 1 次 loaded/list → turns/list 与 items/list 并行，各 1 次 |
| 会话列表刷新 | 1 次认证 → 1 次 thread/list → 本页每个 thread/read 并行各 1 次。0.8.44 的 list 缺少持久 name，read 提供；无第二份名称缓存 |
| 会话写入 | 1 次认证 → 1 次 readThread 校验 → 1 次写入 → 列表刷新；清空另读取新线程模式 |
| 旁问 / 控制轮次 / Shell | 1 次认证 → 1 次对应 RPC；终态依赖事件。控制轮次完成另读取 JSONL（包含历史读取自己的认证检查） |
| 补充指令 | 当前已认证的活跃轮次内 1 次 steer；关联 expectedTurnId，复用轮次认证 |
| 目录范围改变 | 复用设置事务与原生选择；确认后重新认证，范围变化时同一线程 resume 1 次，再读取模式；取消不 resume |

每次 RPC 不会产生独立 Core 子进程；CLI 认证和 Core 连接生命周期仍遵循[连接治理记录](connectionGovernance.md)。

## 实测契约修正

1. 清空请求的模型字段为 `{id,intelligence}`，回执创建新 threadId；不能继续使用旧身份。
2. thread/list 不带持久名称，thread/read.name 才提供名称；列表按页补齐。
3. 新版 turn/activity 是进度事件，不能当未知通知断线，也不能替代终态；相关修复已在同工作区的独立提交中落地。
4. thread/items/list 包含快照独有的 `steerAccepted`（mode、recordSeq、text、completed）。新增独立联合类型，保留文本空白，不把它并入流式 item 枚举；未知结构仍拒绝。
5. archive/delete 失败前不提前取消订阅；成功后撤销线程权限。

## 验证与限制

- **单元/集成**：`pnpm check` 通过 lint、TypeScript 及全部默认测试。覆盖消息白名单、跨会话事件、迟到回执、取消、控制终态竞态、清空新身份、非法清空回执、结构化技能、目录范围及回退两步映射。
- **模拟界面**：`sessionToolsChecks.mjs` 返回 SESSION_TOOLS_UI_OK；1440px 浅色和 380px 深色检查展开菜单、焦点、取消、草稿、窄栏滚动和回退选择；截图人工核对，无 console/CSP error。
- **真实 Core，无模型**：`node --experimental-strip-types packages/app-server/tests/coreContract.ts` 通过目录、会话改名/分叉/归档/解除归档/清空/删除、工具与终端读取；所有写入限定临时工作区并清理。Shell 此层只验证回执。
- **真实 Core 与模型**：`pnpm --filter codem test:live --capabilities` 实际完成本地 Skill、旁问、steer、回退的 conversation 范围、Shell 标记文件写入、所有目录（含 steer 后的实时快照）、改名/清空/删除。压缩正常终态检查失败，因此整个命令保持非零退出，输出 CODEM_LIVE_CAPABILITIES_PARTIAL；其余操作继续验收后清理临时会话。
- **真实 VS Code**：`pnpm --filter codem test:extension` 通过 activation、commands、Webview 及原有 SecretStorage/只读差异/有界日志 smoke。这不是新增每个按钮在原生宿主中逐一点击的验收；该层、真实代码回退/both 范围以及额外目录的真实模型访问尚未完成，不能用浏览器或 fixture 替代。

真实模型最后一次运行从请求返回到终态的等待采样：技能 4.39s、旁问 2.15s、补充指令所在轮次 8.84s、回退 0.26s。这些是单机完成等待采样，不包含前置调用全部耗时，不构成性能承诺。

### Core 0.8.44 压缩缺少终态

临时会话完成任意短轮次后调用 thread/compact/start，收到 turn/started 与 `context compacted: replaced … earlier messages, kept …` 警告，但未收到 turn/completed。完整场景等待 90s 和最小场景等待 20s 均复现；显式 turn/interrupt 后才收到 interrupted/cancelled 终态（最后一次约 0.36s）。

最小复现：构建后运行 `pnpm --filter codem test:live --capabilities --compact-only`。脚本保留失败断言，显式停止以回收资源并继续清理；不会将警告转换为成功。UI 提示正在等待终态，保留停止入口，收到合法终态后重新读取真实历史。

这阻止了“100% 成功验收”的结论。后续 P1 边界是上游 compact 的完成事件；准出标准为同一最小及完整场景在无需 interrupt 时收到关联的正常 turn/completed，客户端读取压缩后的 JSONL 并恢复 ready。仓库是客户端包，不包含 Core 服务端源码。
