# 代码质量门禁

本轮把既有架构边界和关闭生命周期要求接入默认检查，不新增生产依赖。它们约束已知风险，不代表所有交互或所有恶意绕过都已覆盖。

## 运行入口

```bash
pnpm check                 # lint、类型检查、全部 fixture 测试，包含以下两项
pnpm test:architecture     # 架构边界及门禁自身的正反向验证
pnpm test:shutdown         # 退出生命周期故障场景
pnpm build:vscode          # 验证插件可以构建
```

`.github/workflows/quality.yml` 在 PR 和 main 推送时运行检查与构建。使用 Node 22.23.2、pnpm 12.4.1 和冻结锁文件；只读仓库权限，不调用模型。工作流仅在推送后才会执行；要禁止绕过失败检查合并，需要仓库管理员将 `Quality gate` 配为必需检查，本轮未修改远端设置。

Actions 的选型和参数依据 [checkout 官方文档](https://github.com/actions/checkout) 与 [setup-node 官方文档](https://github.com/actions/setup-node)，均固定到已核对的 v7 提交。静态类型导入限制使用现有 Oxlint 1.83.0 的 [no-restricted-imports](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports)，并通过实际执行该版本的反例验证。

## 架构门禁

| 约束 | 执行机制 | 故障注入 |
| --- | --- | --- |
| 活跃生产代码不能依赖 `history/` | esbuild 在内存中解析生产入口；检查原始引用、实际解析路径及符号链接；静态 import/export 同时受 lint 约束 | import、export、字面量动态 import、require、TS 路径别名、符号链接 |
| 共享包保持独立于应用和编辑器 | 拒绝 VS Code、Electron、React 引用；相对路径不能跨出本包源码，跨包需用公开导出 | 编辑器类型导入、Electron 动态导入、相对路径进入应用 |
| 共享包没有 DOM 环境 | 明确的 ES lib 和 Node/空 types；默认 tsc 检查 API 使用 | 添加 DOM lib 或 vscode ambient types |
| 协议包保持可移植、无运行时依赖 | 拒绝外部运行时导入及 dependencies/peerDependencies/optionalDependencies | Node 内置导入及三种依赖声明 |

检查只编译解析，不执行应用、启动 Core 或写入 bundle。负向测试在系统临时目录构造小工作区，结束后删除，不污染真实源码。使用现有 esbuild，不新增解析器或规则框架。

边界：检查生产 `src/` 和 Webview；不审计第三方依赖内部实现，也不能静态判定运行时拼接路径、eval 或全部类型别名。类型导入检查与运行时依赖解析互补，不把字符串正则扫描当作完整依赖图。

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

## 验证层次

- 2026-09-20 本地结果：`pnpm check` 通过（217 个测试，含本轮 7 个关闭故障测试、13 个架构门禁测试）；`pnpm build:vscode`、`actionlint .github/workflows/quality.yml`、`git diff --check` 通过。测试总数包含同期其他任务的预览测试，不将它们计为本轮新增覆盖。
- 单元/集成：默认检查包含架构反例和真实子进程 fixture；不使用真实凭据。
- 模拟界面：本轮未运行，未修改交互布局。
- 真实 Core：本轮未运行；进程回收证据来自协议 fixture。
- 真实 VS Code：本轮未运行；未宣称退出、重载的完整 UI 验收通过。
- GitHub Actions：本轮仅本地校验工作流与等价命令，未推送或触发远端运行。
