# 准出标准

本文定义两道关口：**合并准出**（PR 合入 `main`）和**发布准出**（交付 VSIX 或 JetBrains 插件包）。每项写明由谁判定：CI 强制、评审把关，或按改动风险追加。各门禁的实现、正反向验证与边界见[代码质量门禁](qualityGates.md)，目录职责见[目录组织](sourceOrganization.md)，打包细节见 [VSIX 打包](packaging.md)。

未满足的项不能以测试总数、截图或模型自述代替；未执行或受阻的层次必须在 PR 或发布记录中列出原因。

## 合并准出

### 一、CI 强制（`.github/workflows/quality.yml`）

PR 和 `main` 推送时运行；任何一步失败即不准出。

| 作业 | 步骤 | 判定 |
| --- | --- | --- |
| Quality gate（ubuntu） | `pnpm install --frozen-lockfile` | 锁文件与各 `package.json` 一致 |
| | `pnpm check` | Oxlint 零警告；TypeScript 7.0.2 类型检查（含 Webview 与 Kotlin 编译）；全部包测试，含架构、目录、命名、工作区卫生、样式、关闭生命周期门禁与 JetBrains Gradle 域测试 |
| | `pnpm build:vscode` | 插件与 Webview 可构建，许可证清单生成成功 |
| | 工作树保持干净 | 检查与构建后 `git status --porcelain` 为空：构建产物都被忽略，测试不改写受跟踪文件 |
| Windows（x64、arm64） | `pnpm lint && pnpm typecheck` | 同上 |
| | `pnpm test:windows` | 路径、运行时与进程生命周期在 Windows 上成立 |
| | `pnpm build:vscode`、`pnpm --filter codem test:runtime` | 原生构建成功，内置 Core 可初始化，认证程序可执行；不登录、不调用模型 |

仓库管理员需把 `Quality gate` 与两个 `Windows` 作业设为 `main` 的必需检查，否则失败的 PR 仍可被合并；此项是远端设置，不在代码中。

### 二、评审把关

- **提交形态**：commit 与 PR 标题为 `type(scope): 描述`，type 取 `feat`、`fix`、`refactor`、`optimize`，必须带 scope；每个问题一个 commit；一个 PR 只处理同一类问题；以 rebase 合并。
- **边界**：不依赖 `history/`；共享包遵守 Node-only / 无业务逻辑 / 仅浏览器能力的分工；界面不接触原始协议帧、密钥或任意路径；菜单与控件使用 shadcn/ui。
- **防复发**：修复附带在修复前失败、修复后通过的验证；能机械判定的新约束接入 `pnpm check`，并有正反向用例。
- **结构调整**：写明当前问题、目标边界、状态所有者与清理时机；原子迁移调用方并删除被替代实现，不留转发文件。
- **文档同步**：改动门禁、目录或打包流程时同步更新对应文档；门禁文档记录反向验证的日期与结果。
- **依赖**：内部依赖用 `workspace:*`，共享依赖版本只在 pnpm catalog（由工作区卫生门禁检查）；不新增未被引用的依赖。

### 三、按风险追加

| 改动涉及 | 追加验证 | 入口 |
| --- | --- | --- |
| 界面或交互 | 模拟界面中实际展开菜单、焦点与键盘、深浅主题、窄栏；首屏在 Host 延迟或未响应时控件状态正确 | `pnpm --filter @codem/ui preview`、`apps/vscode/tests/*Checks.mjs` |
| 认证、RPC、子进程、Core 协议 | 真实 Core 闭环；记录每次昂贵操作的次数与阶段耗时，给出可判定的验收标准 | `pnpm --filter codem test:acceptance --workspace <临时工作区>`、`test:live` |
| 扩展激活、重载、退出、面板迁移 | 真实 VS Code 开发宿主中操作，复用已有窗口 | F5 **CodeM VS Code**，**Developer: Reload Window** |
| JetBrains 宿主 | 已开 IDE 内安装并重载 | `apps/jetbrains/README.md` |
| 打包或许可证 | `pnpm test:packaging`；本机 `pnpm package:vscode` 后解压核对 | [VSIX 打包](packaging.md) |

真实模型请求只在显式运行 `test:live` / `test:acceptance` 时发生，默认检查只用 fixture。

### 四、验证报告

PR 描述按以下四层逐项写“通过 / 未执行（原因）/ 受阻（原因）”：

1. 单元 / 集成测试（`pnpm check`、`pnpm build:vscode`）
2. 模拟界面
3. 真实 Core
4. 真实 VS Code（或 JetBrains）操作

## 发布准出

在合并准出全部满足的基础上：

1. 待发布提交在 `main` 上，Quality gate 与 Windows 作业全绿。
2. 版本号已更新（VS Code 为 `apps/vscode/package.json` 的 `version`），固定的 CLI / Core 版本在 `packages/app-server/package.json`、`packages/contracts/manifest.json` 与 README 中一致。
3. 手动运行 **Package VSIX** 工作流，`darwin-arm64`、`darwin-x64`、`win32-x64`、`win32-arm64` 四个作业全部成功，各自产出 VSIX 与 `.sha256`，其中的 `test:runtime` 通过。
4. 至少一个目标平台的 VSIX 在真实 VS Code 中安装，完成登录、选择空间、一次有模型的对话、审批、重载与退出；结果按目标平台记录。未覆盖的平台明确列出。
5. 分发包内容符合[打包边界](packaging.md#打包边界与失败处理)：仅正式 bundle、品牌资源、runtime 与许可证；`THIRD_PARTY_NOTICES.txt` 覆盖实际打入的依赖。
6. JetBrains 包另按 [JetBrains 功能验收](jetbrainsFeatureAcceptance.md) 执行；当前只产出构建机平台，其他平台不得据此宣称可用。

工作流不发布 Marketplace、不创建 Release；这些步骤由发布人手动执行并记录。

## 本地运行的环境前提

- Node `>=22.23.2`、pnpm `12.4.1`、JDK 21；JetBrains 域测试首次运行需要能访问 Gradle 发行版与 Maven Central。
- 进程回收测试（`processLifecycle.test.ts`、`pluginCommands.test.ts`）断言孤儿进程被 init 回收。在 1 号进程不回收僵尸进程的容器中（例如未加 `--init` 的 Docker），这两个用例会失败，属于环境问题而非代码回归；应在 CI、本机或带 init 的容器中复核，不得跳过或放宽断言。无法加 `--init` 时，可在新的 PID 命名空间里由 bash 充当 1 号进程：`unshare -fp --mount-proc bash -c 'pnpm --filter @codem/app-server test'`（2026-09-26 在云容器中直接运行两例失败，经此运行 171 例全部通过）。
