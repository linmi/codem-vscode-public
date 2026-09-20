# 交互验收记录

日期：2026-09-20。运行时：CLI 0.1.208 / Core 0.8.37。下列记录区分真实后端、界面 fixture 和完整 VS Code 操作。

| 范围 | 已验证结果 | 边界 |
| --- | --- | --- |
| 工具详情 | 命令、文件、搜索、网页、MCP、子代理参数白名单；输入敏感字段不透传 | 不将任意原始工具 JSON 当详情展示 |
| 产物 | final_answer 文件/图片/链接/图表卡片；点击交给 Host 校验；晚到回复保留卡片；切换会话后旧句柄失效 | 图表为只读 JSON，非图表绘制 |
| @ 文件 | VS Code 原生查找、键盘选择、引用附件、过期搜索和越界路径拒绝 | 文件名查询，最多 50 条；排除 history、node_modules、dist、.git |
| 大图 | 按需加载、20 MiB 上限、适应窗口/原始尺寸、解码失败提示 | png/jpeg/gif/webp，不加载 SVG |
| 历史图片 | 实际 schema 13 读取器 + 临时附件 fixture，验证路径、摘要、尺寸、修改与过期句柄 | 不是本次真实模型写入图片后恢复的证据 |
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
2. **图片真实发送后恢复**：当前 Core 模型目录只有 `codem-router/auto`，`supportsVision: false`。`test:acceptance --workspace <path> --images` 会明确失败，不绕过该能力校验；模型支持图片后可重复执行该项。现有历史图片 fixture 测试不受此限制。

## 思考加载与整轮计时（2026-09-20）

- 像素加载图标与扫光放在运行中的思考动作行，替换灯泡；顶部保持右侧折叠箭头，只显示「已处理 X秒 / X分 X秒」。失败、停止仍有独立状态提示。
- `ChatSnapshot.turnTimings` 由 Host 所有，按 Core `turnId` 与消息关联。实时开始时间取收到已关联 `turn-started` 的时间；若只有 startTurn 回执，则从确认接受时计时。重复开始事件和回执不重置时间。`turn/completed` 固定终点；断连只结束观测时长，不把任务标记成功。停止回执本身不结束计时。
- Webview 仅每秒刷新标签，流式重绘和面板重建沿用 Host 时间。新会话清空，切换会话替换，历史翻页追加对应的计时。历史耗时来自 Core JSONL 的 `startedAt` / `completedAt`；未完成历史记录不补造终点或重新启动计时。
- 模拟预览以 36 秒作为已标明的 fixture 基线。自动验证覆盖计时位置、递增、完成后停止、新轮隔离、断连、重复/过期事件、完成早于发送回执、历史时间投影与未知时长；未以模拟验证代替真实 Core / VS Code 操作。
