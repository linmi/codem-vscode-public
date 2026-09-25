# shadcn/ui 接入

当前 shadcn 组件、主题适配和全部界面样式都在 `@codem/ui`，VS Code 与 JetBrains 共用；下方按日期的小节记录各轮迁移，其中 `apps/vscode/webview/...` 路径指当时的 VS Code 副本，已于 2026-09-25 删除。

## 来源和适配

- 官方源码：https://ui.shadcn.com/r/styles/new-york-v4/select.json
- 官方安装说明：https://ui.shadcn.com/docs/installation/manual
- 组件源码：`packages/ui/src/components/ui/`；MIT 许可证随源码保留在 `packages/ui/src/components/shadcnLicense.md`，VS Code 构建从该文件写入第三方声明。
- 保留官方 Radix 结构、键盘和焦点行为；cn 改用本地 clsx/tailwind-merge，字号和颜色由 CodeM 主题适配。
- React / ReactDOM 19.3.0、radix-ui 1.6.7、Tailwind 4.3.3；精确版本及完整依赖以 package.json / pnpm-lock.yaml 为准。
- `packages/ui/components.json` 与 `packages/ui/tsconfig.json` 的 `@/*` 路径已配置。后续组件沿用这个入口，不新增另一套组件库。
- Tailwind 仅引入 theme/utilities，不注入全局 Preflight；元素默认样式在 `styles/base.css`，层序为 theme → base → utilities，无层的产品规则仍高于所有层；`packages/ui/src/styles/shadcnStyles.css` 用 `@source "../"` 扫描整个 `packages/ui/src`。两个宿主编译同一入口：VS Code 的 `webview/styles.css` 引入 `@codem/ui/styles.css`，经同一 Tailwind 流程编译后只追加 `body.vscode-*` 限定的主题桥接。
- CSP：Select 视口样式从页面脚本读取 nonce；Dialog/Select 滚动锁样式经 get-nonce 取 nonce，由 `webview/main.ts` 与预览导航入口各自设置。没有放开 unsafe-inline 或外部脚本。
- 预览导航使用独立 React root 和独立 bundle，直接复用 `@codem/ui` 的 Button、Collapsible、Select；卸载页面时清理；正式 Host 不加载预览脚本。

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

会话命令可用性由 `src/shared/sessionCommands.ts` 统一计算并在选择时再次检查。输入模式共用主输入框及 `ComposerSubmission` 的 requestId / 编辑修订收据；普通消息草稿与能力输入草稿分开保存。`/skills`、`/catalog`、`/directories` 只打开详情，目录仍需显式刷新。测试脚本由 `sessionToolsChecks.mjs` 迁移为 `sessionCommandsChecks.mjs`，旧入口命中仅保留在迁移文档和负向断言中。

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

## 本地思考强度选择

`webview/composer/effortSelector.tsx` 使用现有 shadcn/ui Select，四档和默认值来自无运行时依赖的 `@codem/protocol`。菜单不再经过 PanelBroker；旧 `selectEffort` 消息被值校验严格的 `setEffort` 替代。触发器保留 DOM id 供焦点、预览和布局检查使用，信号格数随已选择值变化。保存范围与失败行为见 `localEffortSelection.md`。

## 输入栏菜单本地化

`webview/composer/composerMenus.tsx` 接管工作模式、权限、附件类型、模型和空间菜单。固定项使用 Select；动态目录使用 Popover + Command，支持搜索、键盘选择、焦点恢复和碰撞边界。模型/空间的空状态也本地展示，只有明确点击连接或刷新才请求服务。`settingsPanels.ts`、Host 的四种 picker 面板和手写模型搜索/弹层定位已删除；审批与问答仍由 PanelBroker 管理。`/files`、`/model`、`/mode` 打开同一组件，行为及验证见 `localComposerMenus.md`。

## 独立账户页面

`webview/account/accountView.tsx` 使用 React 与现有 shadcn/ui Button，复用主题令牌，分别提供居中登录页、头像入口和紧凑个人账户页。没有新增依赖、手写菜单或原生 select。身份仅来自 Host 白名单 `AccountState`，认证行为、刷新失效和状态保存范围见 `accountExperience.md`。

账户头像使用 `components/ui/avatar.tsx`（shadcn Avatar / AvatarImage / AvatarFallback），来源和生命周期见 `accountExperience.md`。缺图时由 Radix 的图片加载状态显示后备头像，删除原手写圆形 span 实现；两处头像保持固定尺寸和无 Referrer 图片请求。

## 搜索菜单基础样式修复（2026-09-20）

空间和模型菜单的 CommandInput 缺少无 Preflight 环境所需的基础适配。浏览器实测原输入框为 `2px inset` 边框、14px Arial，40px 高输入框超出 36px 搜索行；Popover 和搜索行边框取正文颜色。项目锁定 Tailwind 4.3.3，继续保留仅导入 theme/utilities 的边界；基础重置语义参考官方 [Preflight 文档](https://tailwindcss.com/docs/preflight)。

`shadcnStyles.css` 统一负责 Popover 主题边框、Command 字体、40px 搜索行、无原生边框且不溢出的输入框，以及搜索行焦点指示；删除 `/` 菜单中的重复输入框适配。首次打开、重复打开、搜索、取消和重载仍由原组件管理，空间/会话切换的卸载清理不变；没有新增状态、缓存、RPC、子进程、依赖或反向引用。

验证：`pnpm build:vscode`、定向 Oxlint、`git diff --check` 通过；`composerMenuChecks.mjs` 返回 `LOCAL_COMPOSER_MENUS_OK`，新增浅色 900px / 深色 380px 下实际展开后的边框、字体、焦点指示、输入框与视口边界、过滤/无结果、重复打开、Escape 焦点恢复、重载默认关闭及 `/` 搜索取消保留草稿检查。440px 深浅主题截图已检查。复用 4318 预览服务，仅创建一个 `codem-menu-style` 测试浏览器并在结束后关闭；浏览器无 error 日志。

真实 VS Code：复用空闲开发宿主，执行 Reload Webviews，展开空间和模型菜单确认样式与 Escape 焦点恢复，没有改变实际选择。单元/集成测试本轮未重跑（变更仅限 CSS 与浏览器回归），未调用真实 Core 模型。

## 恢复输入栏旧菜单外观（2026-09-20）

按用户要求恢复迁移前的完整菜单呈现，参考来源为 `276d653920124a4a8f5200999a55c7f0b83ee7aa^` 的 `apps/vscode/webview/styles/panels.css`（pickerPanel、modelSearch 和 choice 样式）及 `webview/panels/panelView.ts` 的标题/关闭结构。既有 Synara 来源说明与版权记录仍见 `UPSTREAM.md`。不恢复旧 PanelBroker picker 或任何历史运行依赖。

空间、模型、工作模式、权限、附件和思考强度继续使用 shadcn Popover / Command / Select / Button。业务菜单共用 `composerPickerMenu`：14px 圆角、8px 留白、70% popover 背景、40px blur / 150% saturation、原 composer 阴影；工作模式与思考强度宽 180px，其余宽 280px。恢复 11px 标题与 22px 关闭按钮、10px 圆角选项、12px 主文字 / 10px 说明、权限图标及当前项标记。空间与模型搜索框恢复独立 8px 圆角、1px 主题边框和实色背景，取消搜索图标与整行底部分隔线；保留后来新增的空间搜索及离线连接入口。

`composerMenuHeading.tsx` 是输入栏各菜单共用的无状态标题组件；关闭直接通知原打开状态所有者。目录菜单打开时聚焦搜索框，键盘候选初始定位到当前选择，避免首项与当前项同时被高亮。搜索条件仍随菜单关闭卸载清理，状态不跨重载保存；会话身份切换、忙碌关闭、选择消息与失败反馈仍走原调用链。没有新状态缓存、RPC、子进程、生产依赖或反向依赖；`/` 命令菜单及预览导航 Select 保持自己的样式边界。

验证：构建与 `pnpm check`（lint、类型和单元/集成）通过。`composerMenuChecks.mjs` 的浅/深主题展开验收返回 `LOCAL_COMPOSER_MENUS_OK`，覆盖旧尺寸/字体/边框/圆角、权限图标、搜索及无结果、键盘选择非首项后重开、关闭按钮/Escape 焦点恢复、离线打开/取消不发 Host 消息和重载默认关闭。单个 `codem-restore-menus` 浏览器复用 4318 服务，检查 440×700 五类菜单的深浅截图，并验证 320×480 下 50 个空间内部滚动与视口边界；控制台无 error。结束后关闭本次测试浏览器，保留其他项目测试会话和原预览服务。

真实 VS Code：复用空闲开发宿主 Reload Webviews，实际展开空间和权限菜单核验，并检查关闭/取消焦点恢复；没有改变实际空间、权限或调用真实 Core 模型。

## 聊天字号与字重调整（2026-09-21）

按用户要求放大并适度加粗整体文字。`synaraTokens.css` 统一字号：正文和输入框 14px、普通界面与工具记录 13px、次要信息 12px、辅助标签 11px、代码 12px。普通界面与正文使用 500 字重，Markdown 强调、表头和执行中任务使用 600，代码保持 400。现有 shadcn 菜单、任务浮层、账户和运行详情共用字号令牌；没有新增组件、状态、依赖或 RPC。正文行高继续为 1.625。

放大后，380×500 的旁路提问失败场景暴露底部区域最小内容高度超过可用空间的问题。footer 允许收缩并在内容确实超高时滚动，避免控件落到视口之外；正常高度的对话不增加滚动条，菜单和浮层仍使用原有 Portal。

验证：`pnpm check`（lint、类型检查、单元/集成测试）和构建通过。复用已有浏览器运行 `composerMenuChecks`、`taskProgressPreviewChecks`、`runtimePopoverChecks`、`workGroupChecks`、`uiDensityChecks` 均通过，覆盖菜单实际展开、键盘焦点、深浅主题、窄栏及短窗口、任务入口与滚动按钮的位置和滚动行为。900×850 浅色和 380×800 深色 Markdown 截图已检查，浏览器实测正文/输入框 14px/500、强调 600、代码 12px/400，均无水平溢出。真实 Core 与真实 VS Code 本轮未执行；本次仅调整界面排版。

## 共享样式与组件归属（2026-09-25）

VS Code 改为发布共享 `@codem/ui` 样式，删除 `webview/styles/` 与各功能目录中的样式副本以及未进入生产 bundle 的 `webview/components/` 组件副本。此前 `dist/webview.css` 缺少 `.pluginManagementDialog`、`.pluginManagementScroll`、`.activityAction` 及共享组件用到的 `bg-primary` 等工具类，JetBrains 与 VS Code 呈现已不一致；现在两端编译同一份样式。VS Code 只保留主题桥接：VS Code 注入的 `--vscode-*` 在浅色 `.codem-light` 内继续生效；高对比主题映射到 VS Code 高对比色。`webviewStyles.test.ts` 防止再次分叉。

共享 Select 视口此前不带 nonce，正式 Webview 每次打开输入栏 Select 都触发一次 CSP 拒绝；现在沿用页面 nonce。预览场景主题选择器同时改用共享组件，`previewNavigationChecks.mjs` 的控制台错误断言因此也覆盖共享 Select 的 nonce。

当时未改：共享 `product.css` 的无层 `button { background: transparent; color: inherit }` 比 Tailwind `@layer utilities` 优先，shadcn 默认按钮的 `bg-primary` 虽已进入产物但不会着色，两端相同。已由下节处理。

## 样式层级（2026-09-25）

问题：元素默认样式（`*`、`html`/`body`、`button` 重置与悬停、焦点、`[hidden]`、减少动态效果）写在无层的 `product.css`，无层规则总是压过 `@layer utilities`，shadcn Button 的 outline 边框、`bg-primary`、`bg-destructive` 与 `hover:bg-accent` 全部失效；`toolPanels.css` 只在 `.toolDialog` 内补回，`account.css` 用 `!important`。发送/停止按钮的 `!important` 让紧随其后的悬停规则永远不生效。`product.css` 里还有九组同选择器规则被后文静默覆盖，以及原生 `<details>` 替换 Radix Collapsible 后遗留的 `[data-slot="collapsible-trigger"]` 死规则。

处理：元素默认样式移入 `styles/base.css`，`styles.css` 先声明 `@layer theme, base, utilities` 再以 `layer(base)` 引入；按钮重置保留 `0 solid var(--line)`，shadcn 的 `border` 类只给宽度，颜色即 shadcn 基础层的 `border-border`。`main`/`footer` 改为 `#scrollArea` 与 `.app > footer`，不再以元素类型匹配。删除 `.toolDialog` 内补回的 outline、destructive、悬停及字号规则和 `account.css` 的 `!important`；Button 的 `text-sm` 由 `[data-slot="button"]` 统一为 `--uiFontSize`，与 Select、Command 的适配方式一致。原先依靠无层全局悬停（特异性高于组件类）变深的静默色按钮，改在各自规则里写出悬停：`.iconButton`、`.textButton`、`.composerModeBar > button`、`.composerMenuTrigger`、`.composerMenuClose`、`.toolTabs` 标签、`.codeSelectionPin/Remove`、`.userCodeHeader button`、`.copyMessage`、`.jumpLatest`、`.artifactCard`；`.decisionChoice` 去掉多余的透明底色，`.primaryButton` 与发送/停止按钮共用悬停。重复规则合并为最终生效的一条，删除 collapsible 死规则和被 base 覆盖的 `welcome.css` 减少动态效果 `!important`。

VS Code 把宿主默认样式作为第一个层（`vscode-default`）插在 `<head>` 最前，排在 base 之前，宿主的 `body { padding: 0 20px }` 不会盖过共享 base。VS Code 模拟预览的 `preview.css` 原本追加在 `webview.css` 之后，其 `vscodeHost` 层会排到 base 之后；`webviewPreview.ts` 改为在 `webview.css` 之前引入，与真实宿主顺序一致。JetBrains 注入的是无层 `!important` 背景色和前景色，不受影响。

可见差异：outline 按钮有 1px `--line` 边框和表面底色（插件管理、登录中取消、工具对话框外的次要按钮）；default 按钮为 primary 底色（插件安装、会话搜索）；destructive 为实心错误色白字，工具对话框内原来的描边样式随补丁一起删除，所有对话框一致；shadcn 按钮禁用透明度按设计为 0.5（原生按钮仍为 0.4）；键盘焦点为 shadcn 的 3px 焦点环，工具对话框和输入栏触发器保留原有描边；退出登录悬停时保持错误色，不再变成正文色；停止按钮悬停变浅生效；深色下 ghost 悬停底色改为 `--soft`（与 `--hover` 相差约 1% 透明度）。菜单、账户登录按钮、活动行布局与此前一致。

门禁见 [qualityGates.md](qualityGates.md#样式层级门禁)。

同类遗留一并处理：

- 顶栏“文件与工具”和底栏“运行详情”入口此前按 shadcn `size-9` 渲染成 36×36。它们的尺寸规则写成 `.toolPanelTrigger[data-slot="button"]` / `.runtimeDetailsTrigger[data-slot="button"]`，但 `DialogTrigger`/`PopoverTrigger` 以 asChild 包住 Button 时会把 `data-slot` 换成 `dialog-trigger`/`popover-trigger`，规则从未命中。改为只按类名选中，恢复 28×28 与 24×24、静默色和悬停变深，与相邻图标按钮一致。
- 未固定的代码选区块在 `codeSelection.css` 用 1px `--line` 虚线描边（`outline-offset: -1px`，不占布局）。`product.css` 另有一条遗留的 `border-style: dashed`，边框宽度随之取默认的 3px、颜色取正文色，叠在描边外，块高从 28px 撑到 34px。删除该条，未固定只剩虚线描边，固定后无描边。

## 图标来源（2026-09-25）

输入栏菜单删除了复制自 `chat/uiIcons.ts` 的图标路径和 `permissionIcons`，改为直接使用共享定义，外观不变；`chatApp.test.ts` 检查权限、附件和空间触发按钮用的是共享图标。

目前两套图标并存：shadcn/ui 基础组件和后来写成 React 组件的控件使用 lucide-react；`uiIcons.ts` 保留迁入前 Webview 的线条图标，粗细与尺寸由所在容器的 CSS 决定。多数路径（check、chevron、search、copy 等）与 Lucide 同名图标形状不同，整体换成 lucide-react 会改变外观，所以本轮没有合并。
