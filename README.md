# CodeM

面向各类客户端的 pnpm monorepo。当前先建立 App Server 基础能力，应用和界面尚未实现；后续 VS Code 客户端的界面与交互参考 VS Code 原生 Chat。

```text
apps/                       各类应用与平台适配（目前为空骨架）
packages/
  app-server/               Core 运行时、认证代理、stdio RPC 与会话管理
  protocol/                 Host 与界面共享的类型、常量和校验
  session-history/          Core JSONL 历史只读解析
history/                    完整旧项目归档，仅作参考
```

`app-server` 是连接已发布 Core 的 Node 客户端包，不是 Core 服务端源码。当前固定 CLI `0.1.208` / Core `0.8.37`，历史格式为 JSONL schema 13。应用通过包公开导出复用服务，不直接引用其他包的内部源码。共享服务不依赖具体应用或界面框架。

## 开发

使用 Node `>=22.23.2`、pnpm `12.4.1`：

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` 运行活跃包的类型检查与测试，也可分别执行 `pnpm typecheck`、`pnpm test`。尚无应用启动或界面构建命令。

## 历史与复用

旧项目在提交 `904dddd` 中归档，原始来源为 `c389c6304f0108cd50fd31ad3b79bd5402f28ad2`。`history/` 不参加 workspace、编译、测试或默认搜索。需要查阅时显式指定历史文件；历史开发规则不支配新实现。

本次仅迁入上述三个包的源码、配置和测试，独立安装依赖并生成新的根锁文件。复制来源、许可证与原始修改记录见 [UPSTREAM.md](UPSTREAM.md)。旧插件、UI、SDK 和旧工作区依赖均留在归档中。
