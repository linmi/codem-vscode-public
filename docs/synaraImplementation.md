# Synara 交互逐项实施记录

基准沿用 `33333439c4b9c74d0097bc01196cccc921f67cf3`。每项记录实现与验证；完成实现不等于整个产品已达到像素级 1:1。

| 项目 | 状态 |
| --- | --- |
| 1 时间线顺序 | 已修复明确 final_answer 之后晚到的执行内容位置；实时和历史共用终态回复排序规则，保留其他内容的相对顺序 |
| 2 执行分组 | 已实现连续执行分组、运行展开、完成收起、失败保留和用户展开状态；浏览器 WORK_GROUP_OK |
| 3 工具详情 | 已补命令、文件、搜索、网页、MCP、子代理的白名单参数详情卡；文件差异卡可打开原生 diff，不透传环境变量等原始输入 |
| 4 思考展示 | 已支持安全 Markdown、进行中动画、完成/停止/失败状态及手动展开；未伪造 Core 未提供的耗时 |
| 5 初始化 | 已加入初始化/连接骨架及模型加载占位；BOOT_LOADING_OK 验证不误闪空白欢迎页 |
| 6 首次等待 | 已加入时间线等待行，区分发送/执行/等待用户/停止，终态移除；不伪造模型内容 |
| 7 历史恢复 | 加载骨架、保留旧记录并标记忙碌、空态防闪、原有失败保留/重试；LIFECYCLE_VIEW_OK |
| 8 模型与强度菜单 | 按最新设计拆成独立强度图标和模型按钮；强度使用 low / medium（默认）/ high / xhigh 列表，直接展示实际档位；移除滑杆及模型菜单内的强度入口。SPLIT_EFFORT_PICKER_OK；保留模型加载状态 |
| 9 决策卡片 | 已补逐题返回与已答内容恢复、计划拒绝反馈；回归覆盖导航伪造/取消/反馈。真实 Core 已通过批准/拒绝、多题回退修改、取消及计划拒绝反馈；VS Code 内逐个点击按钮的全流程仍待验收 |
| 10 附件与引用 | 已实现 @ 工作区文件名搜索、键盘选择及引用附件；图片按需加载，上限 20 MiB，支持放大/原始尺寸及 schema 13 历史图片校验读取。真实图片发送受当前模型能力限制 |
| 11 消息细节与动效 | 已补常用代码语法高亮、代码换行及仅实时新消息进入动画，支持 reduced motion；已支持 final_answer 的文件、图片、链接和图表产物入口；图表仅提供只读 JSON 预览，未实现通用图表渲染器 |
| 12 历史与资源面板 | 已补已加载会话搜索、按日期分组、文件/任务/工具 tabs 和数量、键盘切换；RESOURCES_VIEW_OK。没有假装具备全库搜索或独立终端工作区 |

第 1 项：新增晚到 reasoning/tool 及 schema 13 历史投影回归。排序只依据明确的终态回复，不猜测事件时间、不把所有思考移到整个对话开头。不改变 Core JSONL。

## 集中验证（2026-09-20）

- `pnpm check`：Oxlint、TS 7 和 169 个测试通过。
- `pnpm build:vscode`：通过；CSS 语法警告升级为构建错误，避免无效样式被当作成功构建。
- 浏览器回归：`WEBVIEW_CHECKS_OK`、`PANEL_UI_OK`、`FOOTER_STABLE_OK`、`PICKER_ANCHORED_OK`、`WORK_GROUP_OK`、`LIFECYCLE_VIEW_OK`、`RESOURCES_VIEW_OK`、`NEW_SURFACES_OK`；覆盖新布局、搜索、多选、导航、附件放大、高亮、代码换行、取消和内容安全。
- `test:live`：真实 Extension Host 激活及 Core 流式测试通过，2 个增量，Core 完成后回到 ready。
- 真实 VS Code 手工观察：发送后的等待行可见，Core 工具执行分组位于最终回复之前，结束后收起并恢复输入。没有把模型自称“收到答案”的文字当作卡片端到端验收证据。

## 本轮补齐与验收（2026-09-20）

- `pnpm check`：Oxlint、TS 7 和 177 个测试通过；`pnpm build:vscode` 通过。
- 浏览器回归：原有布局、菜单、资源、问答、图片与安全渲染检查通过，新增 `FILE_MENTIONS_OK`、`TOOL_ARTIFACT_CARDS_OK`、`ARTIFACT_ACTIONS_OK`。产物和差异按钮只发送 Host 句柄。
- 真实 Extension Host 的原生文件搜索测试通过。实时 Core 审批链路使用真实 ChatController、PanelBroker 和 App Server 验证；允许后检查测试文件内容，拒绝后检查文件不存在。多题回退保留选择及文本；取消、计划拒绝及后续停止均回到 ready。
- 新增可复用已有临时工作区的 `test:acceptance`，不启动 VS Code。测试记录与未完成项见 [交互验收记录](interactionAcceptance.md)。

## 仍未宣称完成的对齐范围

不能标记整个产品为像素级 1:1。当前尚未完成已有 VS Code 窗口中逐个点击真实审批按钮的端到端验收；浏览器 fixture 与真实 Core 测试分层通过不等于这一步通过。当前真实目录只有 `codem-router/auto` 且 `supportsVision: false`，图片实际发送及随后从 Core 恢复的闭环受阻；本地大图预览与 schema 13 历史图片读取已有独立测试。另未实现通用图表渲染、完整 provider 分组及 Core 未提供的精确执行耗时。@ 搜索为工作区文件名搜索，不是文件全文检索。
