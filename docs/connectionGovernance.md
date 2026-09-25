# 连接与空间选择治理

2026-09-20；CLI 0.1.208 / Core 0.8.37。

## 行为与生命周期

- 首次连接读取认证与空间目录，准备 Core 并加载模型。只在本次无用户等待的启动事务内复用已验证认证；用户选择对话框返回后重新读取认证，后续操作仍重新校验。
- 空间目录只存在于 Host 当前连接对象中，不持久化为权限依据，不向 Webview 发送账号身份或 managedDirectory。重复打开菜单使用该目录，不启动子进程。
- 菜单提供“刷新空间列表”，显示刷新中状态；关闭菜单中止刷新。失败或取消不覆盖原目录。身份不完整或变化时，建立新连接不能复用旧目录，必须重新读取；最终空间访问仍由 space_prepare 和 Core 验证。
- 切换前保留旧连接，认证、空间准备、模型读取及配置恢复成功后才交接。取消或预检失败保留原会话。
- 交接同步撤销旧订阅和事件权限，立即发布新状态；旧进程退出在后台继续，关闭扩展时等待全部清理任务。旧退出事件不能让新连接掉线。
- 重载仍沿用工作区和空间隔离的配置持久化规则；未扩展缓存到授权结果、凭据或会话历史。

## 调用次数门槛

同一账号、已有空间目录、没有额外原生选择对话框时：

| 操作 | auth status | project_list | space_prepare | 新 Core |
| --- | ---: | ---: | ---: | ---: |
| 原空间菜单到切换 | 3 | 2 | 1 | 1 |
| 新菜单打开或取消 | 0 | 0 | 0 | 0 |
| 新切换预检 | 1 | 0 | 1 | 1 |
| 新首次连接 | 1 | 1 | 1 | 1 |
| 主动刷新目录 | 1 | 1 | 0 | 0 |

原链路次数来自修改前的调用链：previous.authorize、连接认证、Host 启动认证各一次，菜单与连接各读取一次目录。改后真实预检脚本断言上述正常路径调用次数。这张表统计业务请求，不等于子进程数；下文的首次连接优化进一步合并目录与准备所用的临时 broker，不改变表中的业务请求次数。

## 实测与可复现证据

旧链路只读基线单次样本：菜单前认证 702ms、目录 444ms，合计 1147ms；随后连接 2634ms，关闭 2ms。耗时会受冷启动、网络及系统缓存影响，不将单次样本当作百分位指标。

改后两次真实预检样本：首次连接 1198 / 1207ms；复用目录后的连接预检 788 / 987ms。每次都断言首次连接 auth/list/prepare 为 1/1/1，复用目录的预检为 1/0/1。20 次内存目录读取合计约 0.023ms，这不是浏览器绘制耗时。

```bash
node --experimental-strip-types apps/vscode/scripts/profileConnection.ts --workspace /absolute/path/to/existing/trusted/workspace
```

该命令使用真实认证、broker 和 Core，适配 VS Code 的工作区 API；需要已登录和当前空间。它不打开 VS Code，不发送模型任务，不切换全局账号空间，最后关闭所启动的 Core。用当前空间预检新连接，未声称覆盖跨空间权限变化的真实 UI 操作。

## 验证层次

- 单元/集成：193 个测试及类型、静态检查通过。新增覆盖菜单无认证 IO、重复目录读取零请求、刷新失败/取消、账户隔离、身份缺失不复用、认证子进程中止、慢退出不阻塞新界面、旧事件无效、扩展退出等待清理。
- 模拟界面：空间刷新、加载反馈、关闭与重新打开通过。该证据只覆盖 Webview 样式与交互。
- 真实 Core：上述 CONNECTION_PROFILE_OK 两次通过，使用当前空间进行连接预检；不依赖模型输出判断结果。
- 真实 VS Code：本轮自动化只能定位仓库主窗口，窗口菜单未列出开发宿主；未新开窗口，真实菜单点击及重载体验尚未验收，不能标为全流程完成。

## 首次连接的代理启动优化（2026-09-20）

首次打开面板的调用链为 Webview ready → connect → 校验安装包完整性 → auth status → project_list → space_prepare → Core initialize → model/list → MCP SecretStorage → 恢复设置 → ready。每阶段的结果仍由原有所有者管理：Core 拥有连接与线程，Host 保存目录，VS Code 保存工作区设置和加密 MCP 配置。

本次细分样本约 2211ms：安装包校验 35ms、auth 932ms、目录 392ms、空间准备 665ms、Core 启动约 186ms、模型读取不足 1ms。空间目录与准备分别启动一次认证 CLI，重复支付进程与协议初始化开销。

新的 `prepareInitialAppServerSpace` 在一个临时 broker 中串行执行目录查询和所选空间准备。准备成功后关闭 broker，再把只用一次的启动材料交给 Core；不是常驻连接或授权缓存。已保存空间或 CLI 当前空间仍须存在于最新目录，最终访问权仍由 space_prepare 与 Core 校验。

| 行为 | 结果 |
| --- | --- |
| 首次连接，有可自动选择的空间 | 1 次 auth 子进程 + 1 次 broker + 1 次 Core；broker initialize 从 2 次降为 1 次，project_list/space_prepare 各 1 次 |
| 没有可用的自动选择 | 返回目录前关闭 broker；用户选择后重新 auth，再用新的 broker 准备空间 |
| 取消选择或取消连接 | 不创建 Core；在途 broker 超时/取消会退出并被等待回收 |
| 空间准备、模型读取失败 | 不发布 ready；broker/Core 分别由其拥有者清理，重试重新验证 |
| 重复连接、重载 | 不复用上一次启动材料或认证结果 |
| 切换空间，已有同账号目录 | 保持 1 次 auth + 1 次 prepare，目录显示不增加 IO |

同一 CLI 0.1.208 的真实 broker 已验证一次 initialize 后可以依次调用两个工具，遵守其协商版本 [MCP 2025-03-26 生命周期](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle)。本次没有新增 space_commit 或修改全局空间选择。独立 list/prepare 入口保留给主动刷新、已有目录以及用户选择后的新事务，底层共用同一实现。

改前/改后 bundle 使用同一测试工作区、同一已选空间交替测量三次（毫秒）：

| 次数 | 改前首次连接 | 改后首次连接 |
| --- | ---: | ---: |
| 1 | 1355 | 1669 |
| 2 | 2577 | 1077 |
| 3 | 1202 | 1105 |

这三次中位数为 1355 → 1105ms。第一组反而变慢，说明认证、网络和系统调度仍有明显波动；不把这组小样本当成稳定降幅或冷磁盘启动指标。确定性门槛是首次连接 broker 启动和 initialize 均只有一次、每项业务请求只有一次、取消和失败后无遗留进程。

性能脚本现在提供各阶段耗时、broker 次数，且支持未设置全局默认空间的账号显式传 `--space <已选空间的项目 key>`。工作区路径会先规范化，避免 macOS 临时路径别名触发错误的工作区选择。只输出阶段名、次数和耗时，不输出账号、令牌或 broker 原始响应。

```bash
node --experimental-strip-types apps/vscode/scripts/profileConnection.ts --workspace /absolute/path/to/existing/trusted/workspace --space <project-key>
```

CodeM 输出面板新增 `Webview ready`、`Connection runtime`、`Connection MCP settings`、`Connection ready/disconnected` 耗时，可区分界面启动、后端和 SecretStorage 等待。runtime 时间包含用户登录/选择对话框的等待；它与完整 connection 时间有包含关系，不应相加。

新增 9 个默认回归测试覆盖：同一 broker 只初始化一次、启动材料不重复准备、目录失效后选择、选择后重新认证、选择取消、准备后取消、第二次 RPC 挂起/失败时回收与脱敏、模型读取失败关闭 Core、重试不复用旧授权。`pnpm check` 的静态检查、类型检查及 228 个测试通过，`pnpm build:vscode` 通过。真实 Core 只做连接预检，未发送模型消息。模拟界面未运行；真实 VS Code 自动化仍只能定位主窗口，无法选中已有开发宿主，未新开窗口，完整首次打开体验尚未验收。

## 安装包完整性校验不阻塞事件循环（2026-09-25）

调用链：Webview ready → `AccountController.initialize` → `runtimeAccount.read` → `resolveBundledAppServerRuntime` → auth status；随后 autoConnect → `connectRuntime` → `resolveBundledAppServerRuntime` → auth / 空间 / Core。登录、退出、刷新账户、切换空间和断线重连各再调用一次。每次校验先同步读 `runtime.json` 并检查文件与可执行权限，再对 Core（约 13 MB）和认证 CLI（约 77 MB）做 SHA-256，与清单比对后才返回路径，之后才可能启动任何进程。

原实现用 `readFileSync` 整体读入再哈希，校验期间扩展宿主事件循环完全停住。现在 `sha256File` 打开文件后在同一文件描述符上检查普通文件并以 1 MiB 块流式读取、逐块哈希；比对清单、失败即拒绝、不降级到其他 Core 的规则不变，`stageAppServerRuntime` 写清单时使用同一实现。剩余的同步前段（读取约 0.5 KB 清单、stat 与 access）实测中位数 0.15ms，保持不变。

同一台 macOS ARM64、Node 22.23.2、页缓存已热，使用 `pnpm build:vscode` 产出的真实 bundle，每项 7 次取中位数：

| 实现 | 每次校验耗时 | 事件循环最长停顿 | 期间 1ms 定时器执行次数 |
| --- | ---: | ---: | ---: |
| 同步整读后哈希（原实现） | 32.1ms | 32.2ms | 0 |
| 流式异步哈希 | 29.5ms | 1.3ms | 30 |

1.3ms 受 1ms 定时器分辨率限制。冷缓存、较慢磁盘或无 SHA 指令的 CPU 上原实现停顿会更长，本机未测。可复现命令（无 bundle 时自动生成同尺寸文件）：

```bash
node --experimental-strip-types apps/vscode/scripts/benchmarkRuntimeIntegrity.ts
```

回归门槛接入 `pnpm check`：32 MiB 的 Core fixture 校验完成前必须已让出至少 8 次事件循环，同步实现为 0 次；同尺寸改写一个字节仍须因 SHA-256 不匹配被拒绝。

### 同一激活内复用校验结果

按上述调用链，已登录用户首次打开聊天会校验两次（账户读取、自动连接），每次都重读并哈希两个可执行文件；之后每次刷新账户、登录、退出、切换空间和重连再各一次。`runtimeIntegrity.test.ts` 用激活级 fixture 断言首次打开的两次校验都经过同一个校验器。

| 操作（bundle 未变） | 改前读取并哈希的可执行文件 | 改后 |
| --- | ---: | ---: |
| 首次打开聊天（账户读取 + 自动连接） | 4 个，约 180 MB | 2 个，约 90 MB |
| 同一激活内每次后续账户操作、切换空间或重连 | 2 个，约 90 MB | 0 个 |

- 所有者与范围：`activate()` 创建一个 `createBundledAppServerRuntimeResolver`，账户操作和 `connectRuntime` 共用；原生实验入口自建一个。它只存在于扩展宿主内存，不持久化，不跨窗口或进程共享；重载即新建。
- 保存内容：每个可执行文件路径对应一次哈希时打开文件的 dev、inode、size、mtime、ctime 及其摘要。清单、认证、空间和 Core 状态都不缓存。
- 刷新：每次调用仍同步重读并校验清单、stat 和可执行权限，再打开两个可执行文件做 fstat；身份与记录一致才跳过读取，否则重新流式哈希。无论是否复用，都在返回路径前与清单比对，不匹配每次都拒绝。
- 失效：写入、替换、改权限或改时间戳都会改变上述某项（ctime 无法用 utimes 设回）。最后一次变更距开始校验不足 2 秒的文件不记录，避免 FAT/HFS+ 等粗粒度时间戳下同一刻度内的二次改写得到相同身份。

安全边界：摘要与身份来自同一文件描述符；校验后、启动前按路径替换文件的窗口在原实现中就存在，本次未扩大。复用只把“已校验”延续到身份未变的文件。Windows 的 ChangeTime 可由文件所有者设置；但能改写 bundle 的本地用户同样能改写未签名的 `runtime.json`，因此这项校验防的是损坏、部分更新和版本错配，不是真实性边界。

同一基准脚本、同一 bundle、7 次中位数：首次打开两次单独校验 62.5ms，改为一个校验器后 30.6ms；同一激活内后续校验 0.2ms，事件循环最长停顿 0.2ms。原实现首次打开会出现两次约 31ms 的完全停顿。CodeM 输出面板新增 `Runtime integrity: <ms>; hashed <n>, reused <n>`，真实预检脚本断言同一校验器第二次连接复用两个摘要。

回归门槛：复用测试把两个可执行文件的 mtime 设为整秒并等待 2 秒，第一次哈希 2 个、第二次复用 2 个，新校验器不共享结果；同尺寸改写并恢复 mtime 后只剩 ctime 变化，仍须拒绝。去掉身份中的 ctime 或去掉 2 秒限制，对应测试都会失败。
