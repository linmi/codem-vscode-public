# 插件安装管理

## 当前问题与目标边界

原应用只有插件目录读取。Core 0.8.47 的独立 `plugin` 管理命令支持 validate/install/list/enable/disable/uninstall，生产 App Server 没有相应写入 RPC。本 Cycle 使用该版本真实管理命令，Agent 实时通信仍只有 App Server stdio；不发 shellCommand、不通过模型安装、不手写 Core 注册表。

- `packages/app-server/src/plugins/pluginCommands.ts`：Node-only 命令适配与严格清单解析，参数数组启动（无 shell）、输出预算、超时和取消回收。只暴露真实管理端口。
- `apps/vscode/src/plugins/pluginManagement.ts`：唯一操作状态所有者，随机 UI ID → 已读安装记录映射，重复操作互斥、取消后核对、失败结果区分；不接收整个聊天 Controller。
- VS Code Controller：持有聊天/连接互斥，认证与信任校验。运行主轮次或旁路生成时不管理插件；管理命令不重启/停止 Core 或后台进程。后台唤醒历史状态不是当前运行的证据，不用于永久禁用管理入口。
- 共享 UI：shadcn Dialog/Input/Button，显示用户级影响、来源输入、安装状态、技能目录；UI 不持有任意文件路径、真实注册表 key、原始 stdout/stderr。未接入宿主为 null，首屏不显示入口。

安装来源：原生目录选择器选定的本地 `.codem-plugin/plugin.json` 插件；或用户明确输入 `name@已配置市场`。不新增市场仓库管理、不假设 marketplace update 等同于插件升级。独立工作区技能安装不属于这个插件安装 Cycle。

## 状态和交互

首次打开才读取清单与技能，未加载前无空结果/卸载入口。关闭隐藏面板，不打断已经开始的写入；取消按钮终止命令，再核对注册表，不自动重试。安装前 Core validate、读取清单拒绝同名覆盖；启停和卸载前比对原记录，拒绝过期操作。卸载须在 UI 确认，本地源文件保留。

状态仅保存于当前连接；新建聊天不复制插件状态。退出/空间切换使操作失效、取消子进程并等待清理，不接受晚到结果。重载重新读取 Core 注册表。写入完成但清单或技能刷新失败明确区分，不能误导用户再次安装。插件能力仅以当前连接实际返回的技能目录为准。

原生文件夹选择器没有 VS Code 程序化关闭 API；取消/断开会立即释放 Host 的等待，之后选择器返回的目录不再触发安装。清单和面板状态不跨连接保留。本地 manifest 有 64 KB 有界读取预算。

每次用户操作只进行一次认证检查：打开＝1 次 plugin/list 子进程＋1 次 skills/list RPC；本地安装＝validate＋安装前 list＋install＋核对 list，随后 1 次 skills/list；市场安装省略本地 validate；启停/卸载＝检查 list＋变更＋核对 list，随后 1 次 skills/list。检查 list 与核对 list 分别防止旧意图和确认写入，不能互相替代。命令阶段记录耗时，单命令预算 60 秒，取消先 SIGTERM、1 秒后 SIGKILL；POSIX 使用本任务进程组以回收 Git 等子进程，Windows 使用按 PID 的 taskkill 树清理，不按进程名称批量清理。正常操作零模型请求、零 Core 重启。Core 无 CAS 写入协议，对其他进程恰在校验后写入的竞态无法提供跨进程原子保证，核对失败不重试或回滚他人状态。

## 已确认的 Core 限制

隔离 `LINCO_HOME` 的真实 0.8.47 测试中，本地插件安装/启停/卸载及 App Server plugin/list 均正确。包含 `skills/hello/SKILL.md` 的测试插件，在当前连接、全新连接乃至显式 `--plugin-dir` 的 skills/list 中均未被发现。没有把注册成功宣称为技能生效，也没有复制到 `.agents/skills`、双写注册表或静默降级。界面说明“未出现在技能目录中的能力暂不可用”。插件技能发现/调用仍需上游 Core 支持，尚未通过真实模型调用验收。

## 验证入口

- `pnpm check`：管理状态/Host 互斥、真实进程 fixture、目录门禁和共享 UI 契约。
- `pnpm --filter codem test:live --plugin-management`：真正 Core 二进制，隔离用户目录，临时本地插件，安装→重复安装拒绝→禁用→启用→卸载→清单核对；同时报告实际插件技能发现，不伪造。
- 共享预览 `?host=vscode&scene=plugins`；`packages/ui/tests/managementBrowserChecks.mjs` 在已有 Playwright 页面中验证两项功能的搜索/失败/焦点恢复及插件安装/启停/卸载取消与确认、420/1000 宽度。

2026-09-22 本机真实 Core 管理各子进程 4–7ms，安装 validate＋list＋install 约 16ms（不含认证、UI 与技能 RPC），无模型请求。本地安装全闭环已验证；远程市场下载成功路径未连接实际市场验证。Windows 原生进程树行为未在本机执行。

真实 VS Code 开发宿主复用现有窗口，完成：打开管理面板→原生文件夹选择→安装本任务生成的无工具/无 Hooks 插件 `codem-p1-native-20260922`→禁用→启用→取消卸载→确认卸载→清单恢复“尚未安装插件”→Escape 焦点返回管理入口。测试源文件保留。该已认证连接也没有发现测试插件的 hello 技能。未发送模型消息、未停止原有后台任务。

分层结果：本次涉及的 App Server、共享 UI、VS Code 类型检查及全部单元/集成通过；模拟浏览器两项管理流程通过；真实 Core 隔离注册表闭环通过；真实 VS Code 本地安装按钮闭环通过。根 `pnpm check` 的 lint 通过，最终全仓类型检查被并行开发中的 `apps/docs/src/docs/apiReference.ts`（缺少 hasActiveWork）和 `docsApp.tsx`（缺少页面图标映射）阻塞，未修改文档站来绕过。真实市场下载及真实模型调用插件技能未验收，不能以注册表验证替代。
