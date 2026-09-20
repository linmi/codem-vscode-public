# shadcn/ui 接入

本次迁移边界是组件运行环境、构建和模拟预览的场景目录与主题选择器。聊天正文、模型/权限面板和审批仍为原有实现，不能称为全量迁移。

## 来源和适配

- 官方源码：https://ui.shadcn.com/r/styles/new-york-v4/select.json
- 官方安装说明：https://ui.shadcn.com/docs/installation/manual
- 组件源码：apps/vscode/webview/components/select.tsx；MIT 许可证随源码保留在 shadcnLicense.md。
- 保留官方 Radix 结构、键盘和焦点行为；cn 改用本地 clsx/tailwind-merge，添加 Webview CSP nonce，字号和颜色由 CodeM 主题适配。
- React / ReactDOM 19.3.0、radix-ui 1.6.7、Tailwind 4.3.3；精确版本及完整依赖以 package.json / pnpm-lock.yaml 为准。
- components.json 与 TypeScript 路径已配置。后续组件沿用这个入口，不新增另一套组件库。
- Tailwind 仅引入 theme/utilities，不注入全局 Preflight，避免接入时重置既有聊天页面。源码扫描显式限定组件与预览入口；迁移新入口时同步更新扫描范围。
- Select 的 viewport 和滚动锁样式携带文档 nonce；没有放开 unsafe-inline 或外部脚本。
- 预览导航使用独立 React root 和独立 bundle，卸载页面时清理；正式 Host 不加载预览脚本。

## 验收

构建：pnpm build:vscode。静态及单元检查：pnpm check。
运行 tests/webviewPreview.ts 后，以现有 Playwright 会话执行 tests/previewNavigationChecks.mjs 和 tests/previewLayoutChecks.mjs。
检查目录所有场景、当前项高亮、鼠标与键盘切换、主题菜单的 Escape 返回焦点、刷新与重置保留 URL 选择、窄窗口展开/收起，以及右侧预览的居中和底部边界。捕获 console error，包含 CSP 拒绝。

本次浏览器预览使用模拟数据，不触发 Core；真实 Core 和 VS Code 开发宿主未验收，未为本次工作新开 VS Code。

本次结果：pnpm check、pnpm build:vscode、PREVIEW_NAVIGATION_OK 和 PREVIEW_LAYOUT_OK 均通过；宽屏目录与窄屏展开截图已人工检查，浏览器验收期间无 console error。

场景导航已迁移为左侧分组 TOC，使用 shadcn Button 的链接语义和 Collapsible；主题继续使用 Select。宽屏为 220px 目录＋居中预览，700px 以下通过按钮展开/收起目录。场景链接保留主题，URL 支持刷新恢复。Button / Collapsible 源码来自同一官方 new-york-v4 registry，沿用 MIT 许可证。

## 无刷新场景路由

模拟预览使用 TanStack Router 1.170.38 管理 scenario/theme 搜索参数及浏览器历史，目录使用 Router Link，主题使用 router.navigate；禁止通过 location.href 或 reload 进行场景/主题切换。Router 仅作为预览开发依赖，不进入正式聊天脚本。

场景基线由 tests/previewState.ts 统一创建，server 与 router 使用同一参数校验；已存在的 panel/empty 调试链接仍有效。tests/previewRuntime.ts 在当前文档内发布新的模拟快照，切换场景或重置会清理旧定时器、表单草稿和旧面板身份；单独切换主题保留当前场景的交互状态。目录和聊天外框保留 DOM 身份，目录滚动位置不因导航重置。

验证：tests/previewRouterChecks.mjs 检查零新增文档请求、DOM 身份/目录滚动位置保留、前进后退、旧空间刷新失效及连续切换。一次本地浏览器采样中，六次场景更新到下一帧耗时为 11–17ms；这不是生产性能承诺。还需执行 previewNavigationChecks.mjs、previewLayoutChecks.mjs 和既有面板检查。

官方参考：https://tanstack.com/router/latest/docs/routing/code-based-routing 、https://tanstack.com/router/latest/docs/guide/search-params 。通过已锁定版本的本地类型和浏览器行为确认 API。


## App Server 会话工具与回退面板（2026-09-20）

新增独立 React 边界：会话工具、运行详情和回退检查点/范围选择。复用 Select、Button、Collapsible；Dialog、Input、Textarea 源码取自官方 new-york-v4 registry（`https://ui.shadcn.com/r/styles/new-york-v4/{dialog,input,textarea}.json`），MIT 许可证沿用 `components/shadcnLicense.md`。Dialog 滚动锁继续注入 CSP nonce，关闭文案中文化，主题与尺寸使用 CodeM 变量。回退的旧「一律取消」分支已删除；既有模型/审批手写面板仍未迁移。

`sessionToolsChecks.mjs` 在 1440px 浅色、380px 深色验证真实展开菜单、Escape 焦点恢复、目录按需加载、取消不写入、失败保留草稿、迟到回执不清除新编辑、Dialog 内部滚动以及回退两步选择/取消；结果 `SESSION_TOOLS_UI_OK`，无 console/CSP error。截图仅证明模拟 Webview 交互；真实 Core 和 Extension Host 的验证层次见能力接入文档。

## 会话工具与文件资源面板重设计（2026-09-20）

两个入口分别使用 Lucide SlidersHorizontal / FolderKanban，保留可访问名称与悬停标题，统一 28px 点击区域。会话工具分为会话、指令、能力、目录；文件与工具分为文件、任务、工具。两个面板统一使用 shadcn Dialog / Tabs / Button，替换旧资源浮层、手写 tab 键盘处理和 DOM 列表更新。Tabs 源码来自 https://ui.shadcn.com/r/styles/new-york-v4/tabs.json ，沿用 MIT 许可证；保留 Radix 生成的 tab / tabpanel 标识和关联，不覆盖为手写 id。未增加依赖。

交互与状态边界：

- 首次打开默认显示会话 / 文件页签，不自动读取目录、工具或历史。列表内容来自现有 ChatSnapshot，操作仍经 ViewAction 白名单交给 Host；打开、切页签、搜索均不新增 RPC 或子进程。
- 同一工作区、空间、会话内重复打开保留选中页签、搜索条件和未提交输入；目录分类 / 操作目标 / 重命名输入为组件局部状态。会话工具文字和模式继续通过 VS Code Webview state 保存，失败回执保留草稿，迟到成功回执不能清除后续编辑。
- 关闭 / Escape 取消待确认操作并把焦点还给入口；切换工作区、空间或会话身份卸载旧面板，清理本地页签 / 筛选状态。重载后面板关闭，工具草稿仅在保存的 scope 匹配时恢复。工具目录、文件差异、任务状态的事实来源仍为 Host 快照，不在 UI 建立第二份缓存。
- 文件差异包含增删数和预览限制；后台保留运行 / 退出和六种唤醒任务状态；工具增加本地搜索、无结果和未加载状态。忙碌时沿用原有禁用条件，加载失败等 notice 在 Dialog 内可见，不被遮罩盖住。MCP 配置仍使用已有 VS Code 原生流程。
- 对话框尺寸固定上限为 600 × 620px，窄屏和短窗口按可用视口收缩；标题和 Tabs 保持可见，当前页内容独立滚动。预览场景等待属于当前会话的 React 入口挂载，再通过 Tabs 键盘事件选中相应页签，避免旧入口被点击或停留在默认页签。

验证记录：`pnpm check` 与 `pnpm build:vscode` 通过。复用当前内置浏览器，在浅色常规尺寸、深色 380 × 700、380 × 480 验证图标、文件卡片、后台状态、目录菜单实际展开、搜索 / 无结果、键盘左右切换、Escape 焦点恢复、跨页签草稿保留、删除取消、能力目录和旁路失败场景自动展示；浏览器 error / warn 日志为空。没有新开 Chrome 或 VS Code。

`resourcesViewChecks.mjs`、`sessionToolsChecks.mjs` 和 `richPreviewChecks.mjs` 已同步新组件边界，并增加搜索保留、状态更新焦点、失败可见性、跨会话清理及 ARIA 关联回归断言。这些独立 Playwright 脚本本轮未通过 CLI 执行，界面操作通过现有内置浏览器完成。真实 Core 和真实 VS Code 操作本轮未执行。


## `/` 会话命令迁移（2026-09-20）

当前入口为输入框 `/` 或底部斜杠按钮。已删除顶栏会话工具、四页签会话大面板、旧手写 `composerCommands.ts`；文件与工具仍保留独立 Dialog / Tabs。历史小节记录之前各 Cycle 的实现，当前交互以 `sessionCommandsAndChanges.md` 为准。

命令菜单使用官方 shadcn Command（https://ui.shadcn.com/r/styles/new-york-v4/command.json ，MIT），搜索和键盘选择依赖其要求的 `cmdk` 1.1.1；现有 Select / Button 不提供该命令搜索交互，因此新增此单一生产依赖，精确锁定并复用已有 Radix/React。`cn` 和 Dialog imports 适配本地组件；菜单在输入框上方，按实际剩余高度约束滚动区，匹配已有主题和 CSP。未使用 `CommandDialog` 创建额外顶层入口。

会话命令可用性由 `src/sessionCommands.ts` 统一计算并在选择时再次检查。输入模式共用主输入框及 `ComposerSubmission` 的 requestId / 编辑修订收据；普通消息草稿与能力输入草稿分开保存。`/skills`、`/catalog`、`/directories` 只打开详情，目录仍需显式刷新。测试脚本由 `sessionToolsChecks.mjs` 迁移为 `sessionCommandsChecks.mjs`，旧入口命中仅保留在迁移文档和负向断言中。

本 Cycle 的实际验证与未执行层次见 `sessionCommandsAndChanges.md`；独立浏览器脚本未通过 CLI 执行。
