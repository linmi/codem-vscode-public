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

当前入口为输入框 `/`；底部斜杠按钮已移除。已删除顶栏会话工具、四页签会话大面板、旧手写 `composerCommands.ts`；文件与工具仍保留独立 Dialog / Tabs。历史小节记录之前各 Cycle 的实现，当前交互以 `sessionCommandsAndChanges.md` 为准。

命令菜单使用官方 shadcn Command（https://ui.shadcn.com/r/styles/new-york-v4/command.json ，MIT），搜索和键盘选择依赖其要求的 `cmdk` 1.1.1；现有 Select / Button 不提供该命令搜索交互，因此新增此单一生产依赖，精确锁定并复用已有 Radix/React。`cn` 和 Dialog imports 适配本地组件；菜单在输入框上方，按实际剩余高度约束滚动区，匹配已有主题和 CSP。未使用 `CommandDialog` 创建额外顶层入口。

会话命令可用性由 `src/sessionCommands.ts` 统一计算并在选择时再次检查。输入模式共用主输入框及 `ComposerSubmission` 的 requestId / 编辑修订收据；普通消息草稿与能力输入草稿分开保存。`/skills`、`/catalog`、`/directories` 只打开详情，目录仍需显式刷新。测试脚本由 `sessionToolsChecks.mjs` 迁移为 `sessionCommandsChecks.mjs`，旧入口命中仅保留在迁移文档和负向断言中。

本 Cycle 的实际验证与未执行层次见 `sessionCommandsAndChanges.md`；独立浏览器脚本未通过 CLI 执行。


## 弹窗开关的页面宽度（2026-09-20）

症状：打开文件与工具时，标题和输入框一起变宽，关闭后变窄。当前 VS Code 宿主的 `pre/index.html` 为 body 注入 `padding: 0 20px`；应用只重置 margin，留下了这层宿主内边距。锁定版本 react-remove-scroll-bar 2.3.8 在 Dialog 打开时按 body margin 计算滚动锁的 padding，将原先的左右 20px 清零，造成 40px 跳变。

现在由应用明确把 body padding 设为 0，首屏即采用打开弹窗时的宽度。留白仍由 header、transcript、footer 自己负责，首次打开、重复开关、Escape 取消和重载均使用同一布局；不保存额外尺寸状态、不锁死用户的侧栏宽度、不改动连接或弹窗加载与失败行为。无需增加 RPC、子进程或依赖。

预览样式增加低优先级的宿主默认 padding，避免普通浏览器掩盖此问题；`resourcesViewChecks.mjs` 增加弹窗开关前后 app、标题、输入框坐标及尺寸相等的回归检查。复用 4318 服务和一个临时内置浏览器标签页：440px 浅色视口修复前输入框从 376px 跳到 416px，修复后三态均为 416px；360px 深色视口三态均为 336px，没有页面水平溢出。临时标签页已关闭，视口已恢复。

验证层次：扩展构建、`git diff --check` 通过；模拟界面完成上述尺寸实测；复用真实 VS Code 开发宿主重载，打开/关闭弹窗截图确认默认扩宽且布局稳定。纯 CSS 变更未重新运行单元/集成或独立 Playwright 脚本；未发送真实 Core 模型请求。


## 底部运行信息入口（2026-09-20）

运行详情与快捷键合并到 footer 右侧的 `Info` 图标，始终可打开。删除输入框上方 Collapsible 和常驻快捷键文字；操作中的屏幕阅读器状态播报仍保留。使用现有 shadcn Dialog / Button，头部为约 45px 高的单行标题与关闭按钮，说明仅供屏幕阅读器读取；面板按会话状态、Token 四格用量、计划、文件、输出保护、Hooks、快捷键分组；状态使用中文标签，未识别值仍原样显示，0 与未知分开，长内容在面板内滚动。

首次/重复打开：无运行数据也展示空状态和当前发送键规则。Escape、关闭按钮或遮罩关闭，不发 RPC；打开状态只由组件持有，不持久化，重载后默认关闭。同一会话的数据和发送键更新保留面板，workspace / space / thread 切换通过组件 key 清理打开状态。失败记录和输出保护仍来自原有快照，没有新拉取、缓存或 Core 进程。关闭后按 Dialog 语义返回触发按钮，输入草稿不参与此组件状态。

验证：`pnpm check`（包括 176 个 VS Code 测试）与构建通过。复用 4318 预览服务，在原端口重启以载入新 HTML；单个临时内置浏览器验证 440×850 浅色完整运行信息、面板滚动和 380×640 深色空状态，快捷键收进面板且页面无水平溢出。压缩头部后再次通过类型检查与构建；深色窄屏实测头部 45px、面板宽 356px，关闭恢复入口焦点，Enter 可再次展开。临时标签页已关闭、视口已恢复，预览服务保留供继续体验。`richPreviewChecks.mjs` 同步新入口与排版，并增加紧凑尺寸、焦点恢复、快捷键更新、0/未知用量更新及跨会话关闭回归；该独立脚本未通过 CLI 执行。真实 VS Code 当前有用户任务等待审批，本次未重载，不打断该会话；未调用真实模型。

### 运行信息改为锚定浮层（2026-09-20）

当前实现替换上述运行详情 Dialog，采用 shadcn Popover / Button。Popover 的 Root、Trigger、Portal、Content 取自官方 `https://ui.shadcn.com/r/styles/new-york-v4/popover.json`，保留 MIT 许可，使用已有 radix-ui 1.6.7，没有新增依赖。非模态浮层在右下角信息图标上方展开、右侧对齐，间距 8px，宽度最多 320px，高度最多 420px 并受视口可用空间约束；内容内部滚动，没有遮罩或 body 滚动锁。

首次和重复点击切换展开；Escape 返回入口焦点，点击外部关闭且不阻止继续操作页面。状态只在组件内保存，重载默认关闭；同一会话快照、失败状态和快捷键更新继续保留展开，workspace / space / thread 切换卸载关闭。没有加载操作、RPC、子进程或第二份数据缓存；无数据仍显示原有空状态。React root 使用独立 identifierPrefix，避免模拟导航的另一份 React bundle 产生相同 ID，保证浮层标题的可访问名称。

删除此组件被替代的 Dialog 引用、关闭按钮和旧 CSS；预览重置改为点击打开中的入口。运行信息回归从 `richPreviewChecks.mjs` 提取到 `runtimePopoverChecks.mjs` 并由前者调用。复用 4318 服务，在唯一新建的 `codem-runtime-popover` Playwright 会话验证 1440×900 浅色、380×640 深色、320×480 浅色，结果 `RUNTIME_POPOVER_OK`：实际展开位置、无模态/滚动锁、输入框尺寸不变、重复点击、外部关闭、Escape/Enter、内部滚动、用量/快捷键实时更新、跨会话关闭、空状态与重载均通过，截图已检查。检查过程中仅使用模拟数据。

验证层次：构建、类型检查、定向 Oxlint、模拟界面回归通过；纯 UI 边界未重复运行 Core 单元/集成测试或真实模型。真实 VS Code 正在承载其他工作，本次未重载，宿主操作验收未执行。测试浏览器验证后关闭，原预览服务继续保留。
