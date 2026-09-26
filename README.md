# CodeM

面向各类客户端的 pnpm monorepo。首个应用是 [CodeM VS Code 插件](apps/vscode/README.md)，围绕 App Server 实现，界面与交互参考 VS Code 原生 Chat。

```text
apps/
  vscode/                   VS Code 插件：Host、Webview、品牌素材与测试
  jetbrains/                IntelliJ IDEA 插件：Kotlin 宿主、JCEF、域测试
  docs/                     App Server 文档网站（静态页面）
packages/
  app-server/               Core 运行时、认证代理、stdio RPC 与会话管理
  protocol/                 Host 与界面共享的类型、常量和校验
  contracts/                跨语言契约样例与版本基线
  history/                  Core JSONL 历史只读解析
  ui/                       共享聊天挂载
history/                    完整旧项目归档，仅作参考
```

`app-server` 是连接已发布 Core 的 Node 客户端包，不是 Core 服务端源码。当前固定 CLI `0.1.208` / Core `0.8.47`，历史格式为 JSONL schema 13。应用通过包公开导出复用服务，不直接引用其他包的内部源码。共享服务不依赖具体应用或界面框架。

## 客户端规划

[IntelliJ IDEA 插件实施方案](docs/jetbrainsImplementationPlan.md)定义 Kotlin 直连 Core、共享 UI/contracts、能力接入台账与分阶段门槛。工程基线、contracts、Kotlin 域层和 `@codem/ui` 已落地；真实 IDEA 加载与有模型闭环见 [JetBrains README](apps/jetbrains/README.md)。

## 开发

使用 Node `>=22.23.2`、pnpm `12.4.1`：

```bash
pnpm install --frozen-lockfile
pnpm check
```

使用 TypeScript **7.0.2** 进行类型检查，Oxlint **1.83.0** 进行静态检查。

`pnpm check` 依次运行活跃代码的 lint、类型检查与测试，也可分别执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。`pnpm lint:fix` 执行 Oxlint 自动修复。

默认测试包含架构边界门禁和退出故障场景；可分别运行 `pnpm test:architecture`、`pnpm test:shutdown`。PR 工作流还会构建插件。覆盖范围、故障注入与远端启用条件见 [代码质量门禁](docs/qualityGates.md)；PR 合并与发布须满足的条件见 [准出标准](docs/exitCriteria.md)。

运行 `pnpm build:vscode` 构建插件；在 VS Code 中打开仓库，选择 **CodeM VS Code** 调试配置并按 F5 启动开发宿主。在新窗口打开工作区，然后从活动栏进入 CodeM 并连接。

已有开发宿主时，构建后复用该窗口并执行 **Developer: Reload Window**，不必重复按 F5 新开窗口。真实 Core 交互回归也可复用已有的临时验收工作区，不打开 VS Code：

```bash
pnpm --filter codem test:acceptance --workspace /absolute/path/to/existing/temporary/workspace
```

该命令需要已登录、已选择空间以及已构建的运行时；会实际调用模型，在指定临时工作区的父目录创建审批测试文件，并写入 Core 自有会话历史。路径必须在系统临时目录内。详细覆盖与限制见 [交互验收记录](docs/interactionAcceptance.md)。

Oxlint 配置在 `.oxlintrc.json`，启用 correctness 规则，warning 也会使检查失败；归档、依赖及生成目录不参与 lint。配置依据 [Oxlint 官方文档](https://oxc.rs/docs/guide/usage/linter/config)。类型检查仍由各包的 TypeScript 执行。

## 历史与复用

历史插件的命令、菜单、快捷键、设置及已知限制见 [历史 VS Code 插件点位清单](docs/legacyVscodeContributionPoints.md)，供后续功能规划与迁移核对。

旧项目在提交 `904dddd` 中归档，原始来源为 `c389c6304f0108cd50fd31ad3b79bd5402f28ad2`。`history/` 不参加 workspace、编译、测试或默认搜索。需要查阅时显式指定历史文件；历史开发规则不支配新实现。

本次仅迁入上述三个包的源码、配置和测试，独立安装依赖并生成新的根锁文件。复制来源、许可证与原始修改记录见 [UPSTREAM.md](UPSTREAM.md)。旧插件、UI、SDK 和旧工作区依赖均留在归档中。
