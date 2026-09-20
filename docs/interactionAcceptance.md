# 交互验收记录

日期：2026-09-20。运行时：CLI 0.1.208 / Core 0.8.37。下列记录区分真实后端、界面 fixture 和完整 VS Code 操作。

| 范围 | 已验证结果 | 边界 |
| --- | --- | --- |
| 工具详情 | 命令、文件、搜索、网页、MCP、子代理参数白名单；输入敏感字段不透传 | 不将任意原始工具 JSON 当详情展示 |
| 产物 | final_answer 文件/图片/链接/图表卡片；点击交给 Host 校验；晚到回复保留卡片；切换会话后旧句柄失效 | 图表为只读 JSON，非图表绘制 |
| @ 文件 | VS Code 原生查找、键盘选择、引用附件、过期搜索和越界路径拒绝 | 文件名查询，最多 50 条；排除 history、node_modules、dist、.git |
| 大图 | 按需加载、20 MiB 上限、适应窗口/原始尺寸、解码失败提示 | png/jpeg/gif/webp，不加载 SVG |
| 历史图片 | schema 13 fixture 验证路径、摘要、尺寸、修改与过期句柄；真实图片发送后重连并恢复字节也已通过，见下文 | 无界面控制器验收，不代替 VS Code 图片按钮操作 |
| 允许审批 | 真实 Core 发出权限请求，PanelBroker 回答 allow_once，测试文件内容验证成功 | 通过调用 broker 模拟按钮提交 |
| 拒绝审批 | 真实 Core 发出权限请求，回答 reject_once，测试文件不存在 | 同上 |
| 多题问答 | 真实 ask_user 两题，返回上一题、恢复选择与文字、修改并提交，最终 ready | 同上 |
| 取消提问 | 真实 ask_user 取消并结束，面板关闭，最终 ready | 同上 |
| 计划反馈 | 真实 exit_plan_mode 拒绝并提交反馈；模型若继续请求，显式停止并等待终态 | 同上，不把继续规划当作失败或直接伪造完成 |

## 可重复执行

先构建 `pnpm build:vscode`。已有开发宿主只需重载，不重复启动窗口。

```bash
pnpm --filter codem test:acceptance --workspace /absolute/path/to/existing/temporary/workspace
```

命令主动调用真实模型，使用已登录的凭据代理与已选空间。只传已有的专用临时工作区；工作区父目录也应为专用临时目录，测试会写入 `allowApproval.txt`，并要求 `denyApproval.txt` 不存在。它不打开 VS Code，不替代 VS Code 按钮点击验收，也不绕过生产的 Workspace Trust。

最近真实运行标记：

```text
REAL_INTERACTION allow permission
REAL_INTERACTION deny permission
REAL_INTERACTION question question
REAL_INTERACTION cancel question
REAL_INTERACTION plan plan
CODEM_LIVE_INTERACTIONS_OK
```

默认 `pnpm check` 不调用真实模型。177 个测试、静态检查与构建通过；浏览器回归包含 WEBVIEW_CHECKS_OK、PANEL_UI_OK、FOOTER_STABLE_OK、PICKER_ANCHORED_OK、WORK_GROUP_OK、LIFECYCLE_VIEW_OK、RESOURCES_VIEW_OK、NEW_SURFACES_OK、SPLIT_EFFORT_PICKER_OK 和 ARTIFACT_ACTIONS_OK。

## 未完成与阻塞

1. **已有 VS Code 窗口中的真实按钮操作全流程**：自动化目前只能定位仓库主窗口，不能稳定控制现有扩展开发宿主。已停止新增窗口，待可定位已有宿主后补验；不得将以上分层测试标成完整 UI 端到端通过。
2. **图片真实发送后恢复**：此前以 `supportsVision=false` 判定受阻的结论已撤回。Core 能通过 `describe_image` 识别 localImage；客户端及验收的错误拦截已移除，验证结果见下文。真实 VS Code 图片选择与发送按钮仍需单独验收。

## 图片发送判定修正

问题：`ConversationResources.validateSelection` 将模型目录的 supportsVision 用作整个 Agent 图片输入的准入条件。Core 0.8.44 的 `codem-router/auto` 虽返回 false，仍接受 localImage，并能通过 describe_image 正确识图；旧测试同时要求 supportsVision=true 和禁止调用工具，固化了错误模型。

目标边界：资源模块只负责本地附件有效性，Core 负责图片处理。移除模型能力参数及发送前的布尔拦截，保留真实文件、绝对路径、类型、20 MiB 上限以及技能与附件组合限制；保留协议目录的原始 supportsVision 值，不篡改为 true，不新增能力缓存或第二条发送通路。

状态与交互：首次选择、取消选择和预览沿用资源模块；重复发送仍受当前轮次约束。发送失败保留选中附件，Core 确认接收后消费附件；连接重建与会话切换撤销旧句柄，已发送图片继续由 Core JSONL 恢复。此修复不新增认证、RPC 或子进程；沿用既有连接、必要的 thread/start 和一次 turn/start。没有新增可变状态或反向依赖。

验证入口：`pnpm --filter codem test:live --images`。该分支无界面运行，不启动 VS Code；仅创建临时工作区、独立历史根目录及 Core/CLI 子进程，结束后关闭连接并清理。旧的 `test:acceptance --workspace <临时路径> --images` 复用同一验收实现。

真实验收使用随机排列、带轻微噪声的 1024×1024 四色 PNG（大于 512 KiB），验证实际颜色顺序而非仅回答固定成功标记；允许图片识别工具，保留默认审批边界。发送后关闭控制器和 Core，删除原图片文件，再建立连接、恢复会话并逐字节验证 Core 保存的图片，确认旧连接句柄失效。颜色断言接受等义中英文名称，仍严格比较四个位置的顺序。

本轮结果：

- **单元 / 集成**：新增 supportsVision=false 场景在修复前因 0 次发送而失败，修复后与 true 场景均通过；同时验证 Core 拒绝后保留附件、重试成功后清空，以及文件被删除或增大到超过 20 MiB 时仍不发送。`pnpm check` 通过 lint、类型检查及全部默认测试；构建通过。
- **真实 Core**：`pnpm --filter codem test:live --images` 返回 CODEM_LIVE_IMAGES_OK。Core 0.8.44 / CLI 0.1.208，目录原值 supportsVision=false；本次 2,363,141 字节 PNG 的蓝、黄、绿、红四个区块经 describe_image 全部识别正确，发送至完成约 24.76 秒（单次采样，不是性能承诺）。重连、历史选择、原图已删除后的恢复及逐字节校验通过。
- **模拟界面**：本轮未运行；没有修改 Webview 结构、样式或交互消息。
- **真实 VS Code 操作**：本轮未执行原生图片选择和发送按钮操作，仍作为独立未验收项；未创建 GUI 窗口。验收创建的临时图片、历史目录、工作区及连接均已清理。
- **收敛检查**：生产中不再存在带 supportsVision 参数的 validateSelection 或「当前模型不支持图片」拒绝。supportsVision 在协议、目录显示和 fixture 中继续保留；文档中的旧判定只作为固定基线及本轮修正原因记录，不是兼容路径。

## 思考加载与整轮计时（2026-09-20）

- 像素加载图标与扫光放在运行中的思考动作行，替换灯泡；顶部保持右侧折叠箭头，只显示「已处理 X秒 / X分 X秒」。失败、停止仍有独立状态提示。
- `ChatSnapshot.turnTimings` 由 Host 所有，按 Core `turnId` 与消息关联。实时开始时间取收到已关联 `turn-started` 的时间；若只有 startTurn 回执，则从确认接受时计时。重复开始事件和回执不重置时间。`turn/completed` 固定终点；断连只结束观测时长，不把任务标记成功。停止回执本身不结束计时。
- Webview 仅每秒刷新标签，流式重绘和面板重建沿用 Host 时间。新会话清空，切换会话替换，历史翻页追加对应的计时。历史耗时来自 Core JSONL 的 `startedAt` / `completedAt`；未完成历史记录不补造终点或重新启动计时。
- 模拟预览以 36 秒作为已标明的 fixture 基线。自动验证覆盖计时位置、递增、完成后停止、新轮隔离、断连、重复/过期事件、完成早于发送回执、历史时间投影与未知时长；未以模拟验证代替真实 Core / VS Code 操作。

## 输入框图片粘贴（2026-09-21）

原问题是输入框没有图片 `paste` 入口；文件选择器与 Core 的 localImage 发送能力不能代替剪贴板接入。此次保留原附件样式和普通消息发送规则，只增加截图/图片粘贴。

- Webview 在用户粘贴时读取 PNG/JPEG/GIF/WebP 文件；纯文字不拦截，混合文字仍由原生输入处理。单次图片合计不超过 20 MiB，每条消息仍最多 20 个附件。读取或等待 Host 回执期间禁止发送，成功后复用缩略图、放大和移除入口，失败保留文字草稿并允许重试。
- `shared/pastedImages.ts` 定义有界字节与作用域契约；Host 验证大小、规范 base64、文件头、工作区信任、当前会话和忙碌状态。只由 Host 生成私有临时目录与文件路径，Webview 不能指定路径。粘贴本身不连接 Core、不调用 RPC、不自动发送。
- `composer/imagePaste.ts` 拥有当前 Webview 的读取任务与回执状态。模式/上下文切换取消旧读取，晚到回执不修改新操作；重载从 Host 附件状态恢复，不持久化剪贴板字节。`ConversationResources` 拥有临时文件、句柄和异步清理；移除未发送图片、会话清理或失败批次时回收，发送后保留至消息不再需要预览；关闭连接时等待 Core 退出后再删文件，dispose 等待未完成导入和清理。没有新增反向依赖或连接状态所有者。
- 单元/集成：`messages`、`conversationResources`、`chatController` 回归覆盖图片字节到 localImage、首次连接保留、后续会话粘贴、发送失败重试、过期操作、权限撤销、错误类型/base64/大小/数量、原子清理和关闭时延迟释放。架构门禁随 `pnpm check` 执行。
- 模拟界面：`tests/imagePasteChecks.mjs` 在已有预览服务上验证 ClipboardEvent、缩略图/放大/移除、纯文字与混合粘贴不被阻止、读取与回执期间防误发、超限/格式错误、上下文切换取消和重载。模拟宿主不写文件；文件与发送行为由上述集成测试单独验证。
- 真实 Core：本轮未执行真实模型请求，沿用现有 localImage 通道；此前真实图片记录仍见上文。
- 真实 VS Code：本轮未执行操作系统剪贴板到 VS Code Webview 的按键验收；浏览器合成粘贴事件不作为这一层的替代证据。
