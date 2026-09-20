# VS Code 应用目录组织

## 本轮边界与不变量

现状：Host 功能文件平铺在 `src/`，Webview 状态与视图平铺在 `webview/`，业务组件和 shadcn 基础组件混在 `components/`。本轮按现有职责迁移 VS Code 应用内部路径，不修改业务规则、消息协议、状态所有权、保存范围或清理时机，不移动公共包或历史快照。

首次启动、重复操作、取消、失败重试、重载和工作区/空间/会话切换继续执行原有实现；输入区行为和所有权见 `qualityGates.md`。没有新增认证、网络、RPC、子进程或缓存。验证重点是路径解析、两种扩展构建、Webview 样式扫描、实际展开的菜单以及既有生命周期测试。

## 目标目录

| 目录 | 职责 |
| --- | --- |
| `apps/vscode/src/extension.ts` | 正式扩展入口与组装 |
| `src/chat/` | 聊天协调器、界面容器、HTML 与 Host 展示投影 |
| `src/connection/` | 连接、空间目录、连接偏好和 MCP 配置 |
| `src/sessionHistory/` | 历史读取、列表及历史消息投影 |
| `src/resources/` | 文件、附件、产物句柄和差异内容 |
| `src/integrations/` | 编辑器、终端、Git、补全及其他 VS Code 能力适配 |
| `src/panels/` | Host 交互面板、审批转发和设置选择 |
| `src/nativeChat/` | 原生 Chat 实验入口及适配；不混入正式扩展入口 |
| `src/shared/` | Host/Webview 共用的消息契约、展示规则、输入规则和图标；无平台运行时 |
| `webview/main.ts` | Webview 入口与组装 |
| `webview/composer/` | 输入状态、回执、输入视图、文件引用与会话命令组件 |
| `webview/transcript/` | 消息、工具、Markdown、工作分组和轮次变更展示 |
| `webview/sessionHistory/` | 历史界面 |
| `webview/panels/` | 选择/审批及回退面板 |
| `webview/resources/` | 附件、产物卡片及资源工具界面 |
| `webview/status/` | 加载反馈、工作状态、耗时和运行详情 |
| `webview/components/ui/` | shadcn 基础组件，只依赖自身及基础样式辅助 |
| `webview/components/` | 基础组件样式辅助和许可证；不放业务组件 |
| `webview/styles/` | 现有全局样式、主题与 Tailwind 扫描入口；构建入口仍为 `webview/styles.css` |
| `tests/`、`scripts/` | 包根目录的测试、fixture 与构建/验收脚本 |

## 依赖与门禁

入口组合功能目录；Webview 只能通过 `src/shared/` 使用 Host/Webview 共用代码，不能引用 Host 功能实现。共享契约可以引用无运行时依赖的 `@codem/protocol`，不能反向引用 Host、Webview 或平台运行时。shadcn 基础组件不能依赖业务目录。功能目录可显式依赖相关功能，不以目录移动冒充已消除 Controller 的所有耦合。

目录门禁检查入口目录不再平铺实现、功能目录有明确归属、基础组件不混入业务文件；依赖检查覆盖运行时解析与静态类型导入，规则自身有正反向测试。已有输入状态门禁继续生效。新增职责目录需同步说明职责并调整门禁，而不是不断增加根目录例外。

## 验收记录

- 本轮迁移 84 个现有文件，没有旧路径转发文件，也没有新增 barrel 导出或生产依赖。逐文件对照迁移前内容：除相对导入外，唯一额外的生产内容变化为 Tailwind 的 `@source` 扫描范围；现在扫描整个 Webview 功能目录，并继续扫描预览导航。
- 已同步正式扩展、原生 Chat 实验入口、测试 import 和嵌入 esbuild 的测试入口字符串、类型检查、Oxlint、shadcn 配置、样式入口及来源记录。测试继续留在包根 `tests/`。
- 单元/集成与静态检查：`pnpm check` 通过；`pnpm test:architecture` 已包含目录门禁并通过；新增测试拒绝入口目录平铺、无归属目录、Webview 引用 Host、共享契约反向引用功能、基础组件引用业务，含路径别名与类型引用反例。
- 构建：`pnpm build:vscode` 与 `pnpm --filter codem build:native-chat` 通过；构建不启动 VS Code 或 Core。`git diff --check` 通过。
- 模拟界面：复用既有 4318 服务（PID 60961），只创建一个内置浏览器标签页；实际检查浅色命令菜单、键盘选择、Shell 确认取消后的草稿、展开的主题选择器、深色资源面板及历史列表。控制台无错误/警告，任务结束关闭本任务标签页，保留既有预览服务。
- 真实 Core：未运行；调用链和协议实现未变化。真实 VS Code：未运行；未把两种扩展构建和模拟操作当作真实宿主验收。
- 旧路径搜索：生产实现及构建配置已迁移；旧平铺路径仅保留于 `sourceLayout.test.ts` 的负向测试。公共包与 `history/` 未修改。
