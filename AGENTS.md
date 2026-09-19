# 重写工作区规则

## 当前边界

- `apps/` 放各类应用及平台适配；`packages/` 放通用服务与共享协议。当前先建立 App Server 基础包，首个客户端计划参考 VS Code 原生 Chat 的界面与交互。
- `history/` 是完整旧项目的参考快照，不是活跃应用或 workspace 成员。不要继续修复、重构、安装、构建或启动历史项目，除非用户明确要求。
- 历史目录中的 AGENTS.md、README、迁移计划及构建命令仅记录旧项目规则，不支配新实现，不自动继承其迁移目标或功能范围。
- 当前应用为 `apps/vscode/`，共享包为 `@codem/app-server`、`@codem/protocol`、`@codem/session-history`。不预建其他应用或框架。
- VS Code 第一版使用 TypeScript Webview，Host 与 Webview 通过 `src/messages.ts` 的白名单消息通信；审批使用原生 VS Code 控件。真实模型测试必须显式运行 `test:live`，默认检查使用独立 fixture。
- `app-server` 与 `session-history` 保持 Node-only，不引入编辑器、Electron 或 DOM API；`protocol` 保持无运行时依赖且可用于 Host 和界面。
- 实时通信只通过 Core App Server stdio；Core 拥有 threadId，`turn/completed` 是实时终态依据，Core JSONL schema 13 是唯一持久历史来源。
- 应用负责平台权限、工作区信任、凭据保护和界面适配；不得向界面暴露原始协议帧、密钥或任意文件路径。

## 复用规则

- 有明确需求后才查阅历史文件，按需复制有用实现；不整包搬入旧框架或旧状态管理。
- 新项目不得直接 import、符号链接、workspace 引用或通过路径别名依赖 `history/`。
- 复制代码时同步整理依赖、类型、调用方与必要测试，保留许可证及版权，记录来源路径和提交。
- 历史文件不参加新项目的编译、测试发现、默认搜索或启动流程。

## 工作方式

- 修改前检查工作树，保留用户已有变更。回答、评审和规划请求不自动实施修改。
- 一次完成一个可独立验证的变更，不混入无关重构。
- 使用 Node >=22.23.2 和 pnpm 12.4.1；根目录 `pnpm-lock.yaml` 是活跃工作区唯一锁文件，不使用历史依赖目录或锁文件。
- 内部依赖使用 `workspace:*`，共享依赖版本放入 pnpm catalog。测试放在各包根目录的 `tests/` 中。
- 新建代码文件使用 camelCase（如 `chatController.ts`），类和类型使用 PascalCase；代码文件不使用 `xx-xx` 命名。
- 使用 TypeScript 7.0（当前固定 7.0.2）进行类型检查，Oxlint 进行静态检查。`pnpm check` 依次运行 lint、类型检查和测试；检查范围仅限活跃应用和包。
- 按风险运行必要验证，如实说明未完成或受阻的检查。
- 每个完成并验证的独立变更创建只包含本次工作的 commit；只有用户明确授权才 push。
