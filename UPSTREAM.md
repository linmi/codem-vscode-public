# 代码来源

## 2026-09-19：建立活跃 monorepo

本次按需复制归档中的 App Server 服务包，归档文件保持不变。

来源提交：`c389c6304f0108cd50fd31ad3b79bd5402f28ad2`；完整归档提交：`904dddd`。

| 归档来源 | 活跃路径 | 范围 |
| --- | --- | --- |
| `history/packages/app-server/` | `packages/app-server/` | 运行时、认证、空间代理、协议与生命周期实现，配置及全部测试 |
| `history/packages/protocol/` | `packages/protocol/` | 无运行时依赖的共享协议，配置及全部测试 |
| `history/packages/session-history/` | `packages/session-history/` | JSONL schema 13 读取及 reducer，配置及全部测试 |
| `history/LICENSE` | `LICENSE` | 原样保留原仓库 MIT 许可及 Kilo Code / opencode 版权声明 |

三个包的生产源码、测试及包版本原样迁入；README 更新为新工作区实际边界。根 workspace、脚本和锁文件重新建立，只保留所需依赖。CLI `0.1.208`、Core `0.8.37`、TypeScript `7.0.2`、Node types `24.12.4`、Zod `4.1.8` 延续来源中的版本，无依赖升级。

运行时包具有自己的发布许可证；`app-server` 的 staging 逻辑继续复制 Core 与认证 CLI 的许可证，并校验版本和可执行文件哈希。根 MIT 许可不替代这些外部包的许可。

## session-history 的更早来源

依据归档 `history/UPSTREAM.md` 中的 “Core JSONL history recovery (2026-09-16)”：

- `src/shared/` 来自 CodeM Desktop `main@d7763f0af4a9152e9dd4ca54ce6f1e56862b798c` 的 `packages/cli-adapter/src/records/schema.ts`、所需记录处理器和 `session` / `diff` 领域模块。
- 当时仅保留被使用的 barrel 导出，并将包导入改为本地相对 `.ts` 导入；来源路径无独立许可证或版权文件。
- 当时的两项语义调整为：visitor 暴露 reducer 已有的 initial-submission identity；Host 明确只接受 schema 13。本次没有进一步改变 reducer 语义。
- 公共包装层负责安全路径解析、快照绑定分页、取消和工具 blob 哈希校验，不写入历史，不建立第二套持久存储。

旧应用的集成验证属于历史记录。新工作区必须独立运行自身检查；应用接入后再增加对应集成验证。

本次验证：独立安装及 frozen-lockfile 安装通过；三个包类型检查通过；测试共 99 项通过（App Server 81、protocol 6、session-history 12），无跳过。macOS arm64 的实际已安装 Core/CLI 解析、staging、许可证复制与哈希校验通过；未运行在线认证或真实 agent turn。84 个非 README 包文件与归档逐字节一致，归档无修改，新代码无归档路径依赖。
